# 小考鸭 · 双证学习助手

Windows 离线学习助手，支持年度科目档案、学习计划、任务倒计时、学习统计、动画伙伴与 Serena 离线语音，以及练习记录、错题复习、模拟考试和历年冻结报告。

当前源码版本为 **0.8.1**，数据库版本为 **V7**。应用源码、构建配置和测试位于 [xiaokaoya](xiaokaoya/)，详细开发与交付记录见 [项目说明](xiaokaoya/README.md)。

0.8.1 将侧栏导航改为右侧完整内容页，优化多种窗口尺寸的排版，并内置思源黑体供离线使用。

## 开发

使用 Node.js 24 和项目指定的 pnpm 版本：

```powershell
cd xiaokaoya
pnpm install
pnpm setup:runtime
pnpm dev
```

```powershell
pnpm test
pnpm build
pnpm test:e2e
pnpm dist
```

历史版本升级专项测试还需要本地 `.runtime/baseline` 中的对应旧版编译文件。

仓库包含运行所需的原创伙伴素材和内置离线语音。用户学习数据、私人备份、运行目录、安装包、验收截图及开发语音模型不纳入 Git；历史文档提到的本地验收材料仍保留在原电脑。

## 数据说明

应用数据保存在本机。完整 JSON 用于备份与恢复，CSV 用于表格查看。V7 升级和旧版回退边界见 [0.8.1 安装与数据说明](xiaokaoya/docs/安装与数据说明-0.8.1.md)。
