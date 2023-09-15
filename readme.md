## mirai-webhook

基于 mirai-api-http 的 webhook API，用 QQ 做跨平台的消息推送

可以通过配置中的不同“主题”，来对消息进行分类推送

### 安装

| 步骤         | 命令/操作                                                        | 说明           |
| ------------ | ---------------------------------------------------------------- | -------------- |
| 需求         | `Nodejs`                                                         | 比如`v18.16.0` |
| 下载         |                                                                  | 或者克隆       |
| 安装依赖     | `npm install`                                                    |                |
| 修改配置文件 | 打开`./config.json`，参考[配置文件](#配置文件)的说明，修改，保存 |                |
| 运行         | `npm start`                                                      |                |

### 配置文件

```jsonc
{
  "host": "127.0.0.1", //服务将要监听的ip地址
  "port": 5600, //服务监听的端口
  "wsConfig": {
    //bot服务器配置，使用 websocket。 mirai-api-http 的版本至少为2.0
    "addr": "ws://127.0.0.1:8080", //ws服务器地址
    "key": "1234567890", //认证token，也就是 verifyKey
    "qq": 123456789 //要使用的bot账号
  },
  "topics": [
    //预定义的主题列表。不同的主题可以用于分类不同的通知
    {
      "id": "noti", //主题id，也用作webhook的path
      "desc": "我的通知", //主题简介。目前没有使用
      "secure": {
        //webhook安全设置，用于防止webhook泄露到第三方
        "method": "token", //可以是token或者sigKey，不为以上两者时视为无安全设置
        "secret": "12345678" //足够复杂的字符串
      },
      "targets": [
        //消息的发送目标列表
        {
          "type": "group", //group或friend。前者为发送好友私聊消息，后者为发送群消息。
          "number": 1145141919, //qq号或qq群号，取决于上面的type
          "at": [] //默认要@的对象列表
        }
      ]
    }
  ]
}
```

### 如何使用 webhook

webhook 的实质就是一个 http api 端点。传统的拥有 api 端点的一方为服务提供方(server)，使用该 api 的为该服务的使用方(client)。对于 webhook 来说，没有任何不同，除了双方在概念上的角色发生了转变。

client 提供一个 api 端点，server 去请求这个 api，并通过 api 把信息传递给 client，client 就获得了信息，免去了轮询 server 的浪费和低效。

本 webhook 提供了两种请求方式，分别是 `get` 和 `post`，其中 `post` 要求 `content-type` 为 `application/json`。

数据的传递分为 4 块，分别是 `title`(标题)`、content`(正文)`、token` 和 `sig`。后两者由于安全设置的不同，只会要求提供其一，或者无需提供。

- `title` 作为标题，其提供的文本不会做任何处理，直接拼接到 qq 消息上。虽然没有限制它的长度，但仍建议别太长。
- `content` 作为关键性的正文部分，为了满足一定程度的富文本的需要，要注意一下格式。原始文本会用分隔符`|`进行分割，分割后的每条文本均可使用一种内容格式。目前可以使用 4 种格式：
  - 文本。就是普通的文字。以`txt:`开头的文本，其后面的部分会被视为文字。文字中的`\n` 被视为换行，如果需要显示为`\n`,需要对斜杠`\`进行转义
  - 图片。以`img:`开头的文本，其后面的部分会被视为该图片的 `url`。
  - @消息。以`at:`开头的文本，其后面的部分会被视为要@的成员的 qq 号。
  - 表情。以`face:`开头的文本，其后面的部分会被视为表情 id 或者是表情名称。
  - 全部匹配失败的情况下，默认为文本。
- `token` 字段在该 `topic` 的安全设置为 `token` 时必须提供，且其内容要和 `topic` 的安全设置中的 `secret` 匹配。
- `sig` 字段在该 `topic` 的安全设置为 `sigKey` 时必须提供，且其内容要和服务器计算出的签名相匹配。
- webhook 会对消息的发送情况做出一些统计，并通过 `response` 返回。

```jsonc
{
  "target": 2, //消息发送的目标数量
  "done": 1, //消息成功发送的次数
  "badResult": [{ "target": 123456, "reason": "无效的参数", "code": 2 }], //发送失败的相关信息，包括目标 qq(群)号、失败原因和 code
  "cost": 2345 //当次请求总共花费的时间(ms)
}
```

### 请求示例

<i>以下示例使用[配置文件](#配置文件)一节的主题设置。</i>

#### 最简单的用法：

```http
GET http://127.0.0.1:5600/noti?title=今日天气&content=晴转多云，夜间有雨&token=12345678 HTTP/1.1
```

#### POST 用法：

```http
POST http://127.0.0.1:5600/noti HTTP/1.1
content-type: application/json

{"title":"今日天气","content":"txt:晴|face:太阳|txt:转多云🌥️，夜间有雨🌧️\n|img:https://i0.hdslb.com/bfs/emote/7102c9e25359af8348489ff8529b3bb2c5bd05d0.png","token":"12345678"}
```

### 计算 signature

使用 hmacSHA256，计算如下格式的数据的 hash 值：`title=${title}&content=${content}`。用于计算的密钥为该`topic`的安全设置下的`serect`。

比如`title`为`今日天气`，`content`为`晴转多云，夜间有雨`，`secret`为`1145141919`，那么我要进行计算签名的数据就是`title=今日天气&content=晴转多云，夜间有雨`，计算结果为`20f44def9ee70df5bbf8029546823b934f7e84da0503167f43b94f5a5a226aa1`

### 目前存在的问题

- 可能需要做一个 web 后台，用于管理多个主题
- 没有消息缓存机制，暂时不能对发送失败的消息进行重新发送
- 日志机制十分简单，存在`errors.log`被写爆的风险
