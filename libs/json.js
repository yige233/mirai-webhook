import fs from "node:fs/promises";

export default class JsonFile {
  path;
  content;
  constructor(filePath, content) {
    this.path = filePath;
    this.content = content;
  }
  static async read(filePath, onError) {
    try {
      const content = await fs.readFile(filePath);
      const json = JSON.parse(content.toString());
      return new JsonFile(filePath, json);
    } catch (err) {
      let json = {};
      if (onError) {
        json = onError(err) ?? {};
      }
      return new JsonFile(filePath, json);
    }
  }
  async save() {
    try {
      await fs.writeFile(this.path, JSON.stringify(this.content, null, 2));
    } catch (err) {
      throw new Error("保存文件失败：" + err.message);
    }
  }
  async reload() {
    try {
      const content = await fs.readFile(this.path);
      this.content = JSON.parse(content.toString());
      return true;
    } catch {
      return false;
    }
  }
}
