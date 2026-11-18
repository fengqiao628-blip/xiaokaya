# 第一阶段实施边界与验收

## 已确认合同

正式 userData 固定为 `%APPDATA%\Xiaokaoya\`，sessionData 固定为其 `profile` 子目录。主进程在 app.ready 前设置两者；保持默认持久 Session。origin 固定 `app://xiaokaoya`，scheme 启用 standard 和 secure。数据库名固定为 `XiaokaoyaStudy`。

应用 ID、NSIS GUID 见 README 和 src/shared/identity.ts，由自动化测试核对打包配置。正式版不接受环境变量修改数据目录。开发和测试使用项目 `.runtime` 隔离目录。重大数据、路径、升级或备份策略调整必须先说明风险并确认。

## 本阶段数据字典

- subjects：只初始化 CPA 7 科、税务师 5 科，不自动选科。
- subjectParts：综合测试的试卷一、试卷二内部子项。
- annualPlans：年份唯一，支持 1900—9999，默认下一年度。
- cycles：年度计划与科目组合唯一。学习状态 planned/studying/paused，与后续考试报名和结果分离。
- tasks：关联备考周期；包含日期、内容、预计秒数、备注、六种任务状态、修订号。
- preferences：伙伴 ID、默认周参考目标（12 小时）；不包含业务学习结果。
- quotes、dailyQuotes、quoteHistory：本地励志语、每日持久分配、切换历史。
- studySessions、timeSegments：预留实际时长唯一来源，本阶段仅查询，不提供录入或计时器。

数据库 V1 使用事务保证批量选科原子性。暂停不删除周期和任务。写入采用修订号防止旧编辑覆盖新修改；任务重试采用稳定操作 ID。所有首期业务数据为测试数据。

## 验收项目

1. 构建、TypeScript、日期/数据库/存储合同测试。
2. 实际 Electron 中选科、创建、编辑、完成任务；失效输入不提交且保留表单。
3. 当日语句与伙伴选择刷新、关闭应用后仍保留。
4. 实际累计时长不计入预计时长，不从任务完成推断。
5. app://xiaokaoya 来源、默认 Session、实际 profile 路径及安全隔离配置。
6. 桌面与窄屏无横向溢出，所有图片为本地资源。
7. 生成完整 NSIS 安装包；同版本重装、覆盖更新、卸载后重装保留测试记录。
8. 区分实测结果和仍需实机/虚拟机验证的项目，不将未执行检查标为通过。

## 后续阶段

第二阶段实施完整备份、恢复、预检、迁移、失败回滚后，才正式积累长期记录。本阶段不自动清库、不提供重置数据库或清除历史操作，也不将缺失/打不开的数据库悄悄替换为空库。
