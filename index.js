import crypto from "crypto";
import JsonFile from "./libs/json.js";
import botClient, { Message } from "./libs/bot.js";
import instance, { ErrorResponse, SuccessResponse, StaticSchema } from "./libs/fastify.js";

const CONFIG = (await JsonFile.read("./config.json")).content;

/**
 * 对请求内容进行签名
 * @param {string} title 通知标题
 * @param {string} content 原始通知内容
 * @param {string} sigKey 用于计算hmacSHA256的密钥，即secure下的secret
 * @returns string
 */
function signature(title, content, sigKey) {
  const hmac = crypto.createHmac("sha256", sigKey);
  hmac.update(`title=${title}&content=${content}`);
  return hmac.digest("hex");
}

/**
 * 构建路由
 * @param {object} topics 预定义的话题集合。
 * @returns routeConfig
 */
function buildRoute(topics) {
  let botInstance;
  let connect = async (first = false) => {
    await new Promise((resolve) => setTimeout(resolve, first ? 0 : 1e4));
    instance.log.info("准备连接到bot……");
    botInstance = new botClient(CONFIG.wsConfig, instance.log);
    botInstance.addEventListener("close", async () => await connect());
  };
  connect(true);
  const topicMap = new Map();
  for (let topic of topics) {
    if (!topic.id) continue;
    topicMap.set(topic.id, topic);
  }
  let handler = async (request) => {
    const start = new Date();
    const badResult = [];
    const messageChain = new Message();
    const { title, content, token = null, sig = null } = request.method == "GET" ? request.query : request.body;
    const { targets, secure } = topicMap.get(request.params.topicId);
    if (secure.method == "token" && token != secure.secret) {
      throw new ErrorResponse("ForbiddenOperation", "提供的token无效。");
    }
    if (secure.method == "sigKey") {
      if (sig != signature(title, content, secure.secret)) {
        throw new ErrorResponse("ForbiddenOperation", "提供的签名无效。");
      }
    }
    messageChain.text(`[${new Date().toLocaleString("zh-CN", { hour12: false })}] ${title}\n\n`);
    for (const para of content.split(/\|(?!\|)/i)) {
      const txtMatch = para.match(/(?<=^txt:)[\s\S]*/i);
      const imgMatch = para.match(/(?<=^img:)[\s\S]*/i);
      const atMatch = para.match(/(?<=^at:)[\s\S]*/i);
      const faceMatch = para.match(/(?<=^face:)[\s\S]*/i);
      if (txtMatch) {
        messageChain.text(txtMatch);
        continue;
      }
      if (imgMatch) {
        messageChain.image([...imgMatch][0]);
        continue;
      }
      if (atMatch) {
        messageChain.at([...atMatch][0]);
        continue;
      }
      if (faceMatch) {
        const face = [...faceMatch][0];
        messageChain.face(face, face);
        continue;
      }
      messageChain.text(para);
    }
    for (const target of targets) {
      for (let at of target.at) {
        messageChain.at(at);
      }
      if (!["friend", "group"].includes(target.type)) {
        instance.log.error(`未知的消息发送目标类型: ${target.type}`);
        badResult.push({ target: target.number, reason: `未知的消息发送目标类型: ${target.type}`, code: 500 });
        continue;
      }
      const result = await botInstance.sendMessage(target.type, target.number, messageChain);
      if (result.code != 0) {
        badResult.push({ target: target.number, reason: result.msg, code: result.code });
      }
    }
    return new SuccessResponse({ target: targets.length, done: targets.length - badResult.length, badResult, cost: new Date().getTime() - start.getTime() });
  };
  return {
    routes: [
      {
        url: "/:topicId",
        config: {
          get: {
            handler,
            schema: StaticSchema.getSchema("get"),
          },
          post: {
            handler,
            schema: StaticSchema.getSchema("post"),
          },
        },
        before: (instance) => {
          instance.addHook("preValidation", async (request, reply) => {
            if (!topicMap.has(request.params.topicId || null)) {
              reply.replyError("NotFound", "提供的 topicId 不存在");
            }
          });
        },
      },
    ],
    get: {
      handler: () => {
        return new SuccessResponse({
          message: "mirai-webhook，基于 mirai-api-http 的 webhook API，用 QQ 做跨平台的消息推送",
          version: "1.0.0",
        });
      },
    },
  };
}

instance.register(async (instance) => {
  instance.addHook("onRequest", async (_request, reply) => {
    reply.headers({
      "content-type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    });
  });
  instance.addHook("onResponse", (request, reply) => {
    instance.log.info(`[${reply.statusCode}] ${request.method} ${request.url}`);
  });
  instance.pack("/", buildRoute(CONFIG.topics));
});

const server = await instance.listen({
  port: CONFIG.port,
  host: CONFIG.host,
});
instance.log.info(`mirai-webhook 正运行在 ${server}`);
