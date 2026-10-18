# 依赖与署名

- Folia 原作者：[chthollyphile](https://github.com/chthollyphile)。原仓库：https://github.com/chthollyphile/folia-major 。`host/` 保存针对 Folia 0.7.20 的修改源码和构建产物，遵循 AGPL-3.0-or-later。
- libresoda：https://github.com/sodahub-org/libresoda ，提交 `928797d0cd30469c31b2b8fca4f460be88d248c6`，AGPL-3.0-or-later。[许可证](third_party/libresoda/LICENSE) · [上游声明](third_party/libresoda/NOTICE.md)。构建时由 Cargo 获取源码。
- music-lib 原作者：[guohuiyuan](https://github.com/guohuiyuan)。原仓库：https://github.com/guohuiyuan/music-lib 。libresoda 的汽水实现移植自该项目，AGPL-3.0。
- libmssdk 原作者：ZephyrCheung。原仓库：https://github.com/sodahub-org/libmssdk ，MIT。签名包装器源码位于 `folium-soda/signer/`，保留原[许可证](folium-soda/signer/LICENSE)及[声明](folium-soda/signer/NOTICE.md)。

本仓库仅包含社区适配代码，不代表上述项目官方发布。官方汽水组件、账号会话、设备身份和 Wine 环境不包含在仓库中；运行时脚本从官方地址下载并在本机安装所需组件。
