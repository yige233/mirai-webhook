import crypto from "crypto";
import Fastify from "fastify";
import fs from "fs/promises";

class Plugin {
  static errorResponse(instance) {
    instance.decorateReply("replyError", function (error, message, cause) {
      const code =
        error == "BadOperation" || error == "IllegalArgument"
          ? 400
          : error == "Unauthorized"
          ? 401
          : error == "ForbiddenOperation"
          ? 403
          : error == "NotFound"
          ? 404
          : error == "MethodNotAllowed"
          ? 405
          : error == "ContentTooLarge"
          ? 413
          : error == "UnsupportedMediaType"
          ? 415
          : error == "UnprocessableEntity"
          ? 422
          : error == "TooManyRequests"
          ? 429
          : 500;
      this.status(code);
      this.send(
        JSON.stringify({
          error,
          message,
          cause,
        })
      );
    });
  }
  static successResponse(instance) {
    instance.decorateReply("replySuccess", function (data, code = 200) {
      if (code == 204) {
        this.status(204);
        this.removeHeader("content-type");
        return this.send();
      }
      return this.send(JSON.stringify(data));
    });
  }
  static allowedMethod(instance) {
    instance.decorateReply("allowedMethod", function (...allowedMethod) {
      this.headers({
        Allow: allowedMethod.join(",").toUpperCase(),
        "Access-Control-Allow-Methods": allowedMethod.join(",").toUpperCase(),
        "Access-Control-Allow-Headers": "content-type,authorization",
      });
      this.status(200);
      this.send();
    });
  }
  static routePacker(instance) {
    instance.decorate("pack", function (url, config) {
      const normalMethods = new Set(["get", "post", "patch", "put", "delete", "options"]);
      const definedMethods = [];
      const routes = [];
      for (const method of normalMethods) {
        const configPart = config[method];
        if (!configPart) {
          continue;
        }
        const options = {
          url,
          method,
          attachValidation: true,
          handler: this.packHandle(configPart.handler),
          schema: configPart.schema,
        };
        if (configPart.defaultResponse) {
          options.schema.response = Object.assign({ "4xx": { type: "null" } }, configPart.schema.response);
        }
        definedMethods.push(method);
        routes.push(options);
        normalMethods.delete(method);
      }
      if (normalMethods.size < 6) {
        for (const method of normalMethods) {
          routes.push({
            url,
            method,
            attachValidation: true,
            handler: async function (request, reply) {
              const reqMethod = request.method.toLowerCase();
              if (reqMethod == "options") {
                return reply.allowedMethod(...definedMethods);
              }
              if (!definedMethods.includes(reqMethod)) {
                reply.header("Allow", definedMethods.join(", ").toUpperCase());
                reply.replyError("MethodNotAllowed", `不允许使用的方法: ${request.method}`);
              }
            },
            schema: method == "options" ? { response: { 200: { type: "null" } } } : { response: { 405: { type: "null" } } },
          });
        }
      }
      for (const routeOpt of routes) {
        this.route(routeOpt);
      }
      if (config.routes) {
        this.register(
          async function (instance) {
            for (const route of config.routes) {
              if (route.before) {
                await route.before(instance);
              }
              instance.pack(route.url, route.config);
            }
          },
          { prefix: url }
        );
      }
    });
  }
  static handlePacker(instance) {
    instance.decorate("packHandle", function (handler) {
      return async function packedHandler(request, reply) {
        try {
          if (request.validationError) {
            const {
              validationContext,
              validation: [{ instancePath, message }],
            } = request.validationError;
            throw new ErrorResponse("BadOperation", `对 ${validationContext} 的验证失败: ${instancePath} ${message}.`);
          }
          const result = await handler(request, reply);
          if (result instanceof SuccessResponse) {
            return result.response(reply);
          }
          if (result == false) {
            return;
          }
          instance.log.error(new Error(`意外的响应体类型: ${handler}`));
          reply.replySuccess(result);
        } catch (err) {
          if (err instanceof ErrorResponse) {
            return err.response(reply);
          }
          const traceId = crypto.randomUUID().replace(/-/g, "");
          err.trace = traceId;
          instance.log.error(err);
          reply.replyError("InternalError", `内部错误。跟踪 id: ${traceId}`);
        }
      };
    });
  }
}
export class ErrorResponse {
  error;
  message;
  cause;
  constructor(error, message, cause) {
    this.error = error;
    this.message = message;
    this.cause = cause;
  }
  response(reply) {
    reply.replyError(this.error, this.message, this.cause);
  }
}
export class SuccessResponse {
  data;
  code;
  constructor(data, code = 200) {
    this.data = data;
    this.code = code;
  }
  response(reply) {
    reply.replySuccess(this.data, this.code);
  }
}
export class StaticSchema {
  static getSchema(method) {
    const schema = {
      response: { 200: { type: "null" } },
      params: {
        type: "object",
        properties: { topicId: { type: "string" } },
        required: ["topicId"],
      },
    };
    const body = {
      type: "object",
      properties: { title: { type: "string" }, content: { type: "string" }, token: { type: "string" }, sig: { type: "string" } },
      required: ["title", "content"],
    };
    if (method == "post") {
      schema.body = body;
    } else {
      schema.querystring = body;
    }
    return schema;
  }
}
const instance = Fastify({
  disableRequestLogging: true,
  exposeHeadRoutes: true,
  ignoreTrailingSlash: true,
  attachValidation: true,
  logger: {
    formatters: {
      level(label) {
        return { level: label.toUpperCase() };
      },
    },
    stream: {
      write(msg) {
        const { level, time, msg: message, err = {} } = JSON.parse(msg);
        const date = new Date(time).toLocaleString();
        if (level == "ERROR") {
          const prettyMsg = [`[${date}] [${level}] ${message}`, `  type:${err.type}`, `  message:${err.message}`, `  stack:${err.stack}`, `  traceId:${err.trace || null}`];
          fs.appendFile("./errors.log", `${prettyMsg.join("\r\n")}\r\n`);
        }
        process.stdout.write(`[${date}] [${level}] ${message} ${level == "ERROR" ? err.trace || null : ""}\r\n`);
      },
    },
  },
});
Plugin.allowedMethod(instance);
Plugin.errorResponse(instance);
Plugin.successResponse(instance);
Plugin.routePacker(instance);
Plugin.handlePacker(instance);

instance.setNotFoundHandler((requset, reply) => reply.replyError("NotFound", `请求的路径不存在: ${requset.url}`));

export default instance;
