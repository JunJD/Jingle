# language: zh-CN
@artifacts
功能: Artifacts 主进程契约
  为了让 artifact service 拆分时保持文件和动作行为稳定
  作为 Openwork main process 维护者
  我需要 artifacts API 能列出线程 artifact、读取托管文件并返回安全的 action resolution

  场景: list 会返回当前线程的 artifact
    假如 Openwork 桌面应用已启动
    而且 存在标题为 "BDD Text Artifact" 且内容为 "hello artifacts ipc" 的托管文本 artifact
    当 我读取当前 artifact 线程的 artifacts 列表
    那么 artifacts 列表包含标题为 "BDD Text Artifact" 类型为 "file" 的 artifact

  场景: readFile 会读取托管文本 artifact
    假如 Openwork 桌面应用已启动
    而且 存在标题为 "BDD Text Artifact" 且内容为 "hello artifacts ipc" 的托管文本 artifact
    当 我读取最新 artifact 的文本内容
    那么 最新 artifact 文本读取结果应成功
    而且 最新 artifact 文本读取内容应为 "hello artifacts ipc"

  场景: readBinaryFile 会返回托管文件 base64 内容
    假如 Openwork 桌面应用已启动
    而且 存在标题为 "BDD Binary Artifact" 且字节为 "0,1,2,3" 的托管二进制 artifact
    当 我读取最新 artifact 的二进制内容
    那么 最新 artifact 二进制读取结果应成功
    而且 最新 artifact 二进制读取内容应为 "AAECAw=="

  场景: open download action 会返回托管文件 uri
    假如 Openwork 桌面应用已启动
    而且 存在标题为 "BDD Download Artifact" 且内容为 "download me" 的托管文本 artifact
    当 我以 "download" action 打开最新 artifact
    那么 最新 artifact open 结果类型应为 "download"
    而且 最新 artifact open 结果 uri 应为托管 artifact 路径
