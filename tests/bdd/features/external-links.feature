# language: zh-CN
@external-links
功能: External links 主进程契约
  为了让外部链接只在明确安全的边界内打开
  作为 Jingle main process 维护者
  我需要 shell:openExternal 只允许公共 http(s) URL 并把安全链接转发给 Electron shell

  场景: 公共 https 链接会被转发给 Electron shell
    假如 Jingle 桌面应用已启动
    而且 我开始记录 external link 打开请求
    当 我通过 external links API 打开链接 "https://example.com"
    那么 external links 最近结果应成功
    而且 external links 最近调用 URL 应为 "https://example.com/"

  场景: localhost 链接会被拒绝且不会转发给 Electron shell
    假如 Jingle 桌面应用已启动
    而且 我开始记录 external link 打开请求
    当 我通过 external links API 打开链接 "http://localhost:3000"
    那么 external links 最近结果应失败
    而且 external links 最近错误应包含 "private-network hosts"
    而且 external links 打开请求数量应为 0
