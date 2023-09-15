import WebSocket from "ws";

export default class botClient extends WebSocket {
  session;
  /**
   * 构建一个bot实例
   * @param {object} config bot配置，包括{ addr, key, qq }
   * @param {object} logger (可选)一个log对象，默认为console
   */
  constructor(config, logger = console) {
    const { addr, key, qq } = config;
    if (!addr || !key || !qq) {
      throw new Error("需要提供完整的bot连接配置");
    }
    super(`${new URL(addr).href}message?verifyKey=${key}&qq=${qq}`);
    this.addEventListener("open", async () => {
      logger.info("成功连接到bot服务");
      const { code, session } = await this.expect();
      if (code != 0) {
        logger.warn("连接到bot失败, code:", code);
        return;
      }
      this.session = session;
    });
    this.addEventListener("error", (e) => {
      logger.error(new Error("连接到bot时发生了错误: " + e.message));
    });
    process.on("SIGINT", () => {
      this.close();
      process.exit(0);
    });
  }
  /**
   * 传入一个同步id，并等待ws服务器发出具有该id的消息
   * @param {string} syncId 同步id
   * @returns Promise
   */
  expect(syncId = "") {
    return new Promise((resolve) => {
      let listener = (e) => {
        const reply = JSON.parse(e.data);
        if (reply.syncId == syncId) {
          resolve(reply.data);
          this.removeEventListener("message", listener);
        }
      };
      this.addEventListener("message", listener);
      this.addEventListener("close", () => resolve({ code: 500, msg: "websocket连接关闭了" }));
    });
  }
  /**
   * 发送消息
   * @param {string} type 只支持friend和group，即发送好友消息和发送群消息
   * @param {number} target 消息目标，QQ号或QQ群号
   * @param {Message} message 消息对象
   * @returns Promise
   */
  sendMessage(type, target, message) {
    const types = new Map([
      ["friend", "sendFriendMessage"],
      ["group", "sendGroupMessage"],
    ]);
    if (!types.has(type)) {
      return { code: 500, msg: `未知的消息类型: ${type}` };
    }
    if (!target || isNaN(target)) {
      return { code: 500, msg: `不合法的消息目标(需要提供数字类型的qq号或群号): ${target}` };
    }
    if (!(message instanceof Message)) {
      return { code: 500, msg: `message的类型错误(需要为Message类): ${message}` };
    }
    return this.send(types.get(type), {
      sessionKey: this.session,
      target: target,
      messageChain: message.chain,
    });
  }
  /**
   * 发送任意指令。还不支持子指令
   * @param {*} command 指令
   * @param {*} content 数据
   * @returns Promise
   */
  send(command, content) {
    const syncId = Math.random();
    const data = {
      syncId,
      command,
      content,
    };
    super.send(JSON.stringify(data));
    return this.expect(syncId);
  }
}

export class Message {
  chain = [];
  /** 构造一个消息对象 */
  constructor() {}
  /**
   * 添加文本
   * @param  {...string} texts 任意文本，\n被视为换行
   * @returns Message
   */
  text(...texts) {
    this.chain.push({ type: "Plain", text: texts.join(" ") });
    return this;
  }
  /**
   * 添加图片
   * @param {string} url 图片链接
   * @returns Message
   */
  image(url) {
    this.chain.push({ type: "Image", url });
    return this;
  }
  /**
   * 添加 @ 对象
   * @param {*} target 要 @ 的目标
   * @returns Message
   */
  at(target) {
    this.chain.push({ type: "At", target });
    return this;
  }
  /**
   * @ 全体成员
   * @returns Message
   */
  atAll() {
    this.chain.push({ type: "AtAll" });
    return this;
  }
  /**
   * 添加表情
   * @param {*} faceId 表情id。优先级最高
   * @param {*} name 表情名称
   * @returns Message
   */
  face(faceId, name = undefined) {
    this.chain.push({ type: "Face", faceId: isNaN(faceId) ? undefined : faceId, name });
    return this;
  }
}
