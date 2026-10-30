# StockPilot · TikTok Shop 美国和德国补货工作台

支持 Windows 本地团队部署与独立浏览器开发模式。美国 `/us.html`（首页默认）、德国 `/de.html` 分开保存。团队部署时共享工作区存放在主机磁盘，带访问口令、版本冲突保护和覆盖前备份；无需外部API密钥。原初始化文件名含反引号的 README 保留不变。

## 给同事使用：Windows 双击部署包

下载仓库 `downloads/StockPilot-Windows.zip` 并解压到固定目录。主机已安装 Node.js 24 后双击 `Start.vbs`，无需打开CMD、安装npm依赖或构建。同事只需浏览器，按 `LAN-address.vbs` 显示的局域网地址和访问口令登录。双击 `Enable-LAN.vbs` 按需添加专用网络/本地子网防火墙规则；`Enable-startup.vbs` 设置当前用户登录后自动启动；`Stop.vbs` 停止服务。主机应保持开机、不休眠且用户不注销。详细操作、备份、数据迁移与更新说明见 [Windows部署说明](windows/README-Windows.md)。

团队采用共享口令，没有个人账号或权限分级。仅用于可信内网，不要将HTTP端口映射到公网。业务数据和口令在 `.stockpilot/`，被git忽略且不会打包；页面每5秒同步主机更新。旧版浏览器数据需先导出JSON，再登录团队版导入，不自动上传。

构建部署包：`npm run package:windows`。ZIP 包包含已构建的静态文件、Node服务、计算引擎与Windows启动脚本，不包含Node运行时、node_modules、口令或业务数据。包内资源无需联网加载。Windows脚本尚未在真实Windows环境验证；Node服务与浏览器团队流程已在云端测试。

## 开发环境和启动

推荐 Node.js 24.19.0，最低 22.12；npm 11。依赖精确版本和完整性记录保存在 `package-lock.json`。

```bash
cd /workspace/tiktok-replenishment
bash scripts/setup.sh       # npm ci + 计算测试 + 生产构建
npm run dev                 # 开发服务，端口 5173
```

```bash
npm test                    # 计算与服务端边界测试
npm run build               # 输出 dist/，包括首页、美国和德国页面
npm start                   # 独立浏览器模式的构建预览，4173；需先 build
npm run serve               # 团队模式服务，5173；需先 build
npm run test:e2e             # 先 build；浏览器功能测试，自动启动/关闭开发服务
```

浏览器测试优先使用 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`，其次使用环境已有 `/usr/bin/chromium`，否则使用 Playwright 自带浏览器。普通新机器可执行 `npx playwright install chromium` 安装；受限云环境需要允许其官方浏览器下载域名。当前环境已有系统 Chromium，无需下载或修改网络策略。单元测试使用 `--test-isolation=none` 使此运行时明确报告每个用例。

每个云任务已隔离，直接使用现有检出目录，不另建 worktree。服务进程不会随环境快照恢复，应在新任务按启动说明重启。Vite 服务仅用于开发/构建预览；团队部署使用 `scripts/serve.mjs` 服务，业务数据在主机JSON文件中原子写入。需要公网访问或细分用户权限时应另设HTTPS、个人身份认证与访问控制。

## 首次使用

1. 选择美国或德国，设置分析日期（按店铺口径，库存为当天销售开始前）。默认日期使用 Asia/Shanghai，仅是初始值，可手动调整。
2. 可先载入明确标注的演示数据，或下载三个 CSV 模板。模板的示例行应替换为真实数据。
3. 分别导入销量、库存、在途；支持模板列名 CSV 和 XLSX 首个工作表。每次导入替换对应整表，不追加；错误文件整批拒绝，不修改已有工作区。导入真实文件时先清空演示表，避免混用。
4. 查看产品推荐动作、A/B/C策略和逐SKU海空计划；手动策略优先，按市场和产品独立保存。
5. 导出补货CSV（含风险说明和情景量），或导出/恢复 JSON 工作区备份。开发/预览模式保存在浏览器，不跨设备同步；团队部署模式则统一存储在主机 `.stockpilot/`。团队导入/清空会影响所有同事，旧版本的并发修改被拒绝，需重新载入后再操作。

## 导入列

| 表格 | 必需列 | 可选列 |
| --- | --- | --- |
| sales | market, sku, date, units | product, color, size, in_stock |
| inventory | market, sku, available, snapshot_date | product, color, size, warehouse |
| pipeline | market, sku, qty, shipment_id, eta | product, mode, status |

市场为 `US` 或 `DE`，页面拒绝另一市场；SKU 必须为文本（Excel 中预设为文本），保留前导零。数量为非负整数件，不能留空当作零。日期用 YYYY-MM-DD。`in_stock` 只接受 true/false，空白表示未知。销量只导入有效出库件数，预先排除未付款、取消订单；订单数/GMV不等于件数。

库存必须来自 TikTok 专用仓的可用量，已扣锁定不再扣减。同市场/仓库/SKU多份快照拒绝；多仓合计。没有当日快照的 SKU 不输出可执行数量或情景金额。

在途必须是未反映在库存中的剩余未入库数量，eta 为上架可售日。未填写发货单号、未知/逾期 ETA 不计入供给。`received/completed/cancelled/已入库/已完成/已取消` 不计入。签收不代表已上架；供应商/货代时点需先换算到可售 ETA，工具不会重复叠加在途运输期。

## 计算与参数

- 默认完整周期：海运42天、空运22天（国内2 + 运输30/10 + 清关5 + 上架5）；可在界面修改。
- A 安全21天/批量覆盖21天；B 10/14；C 5/7且默认不空运。首版策略参数固定为启发式默认值，不承诺最优服务水平。
- 近7/14/30天日销按0.5/0.3/0.2加权，使用最多60天历史；缺记录日计零，明确不可售日排除。新品、活动、达人爆量需人工评估。
- 收货先于当天销售逐日模拟，缺货为损失销量，不形成积压；晚到供给不能抵扣早期缺货。先算空运桥接，再算海运；C或空运经济性不满足时重新计算海运。
- 产品经营动作与库存策略分开。明确停推、非正贡献利润或长期明确可售无销量可触发停补；手动经营动作可用 JSON 设置。
- 70%/130%需求压力测试沿用同一发运计划，不赋予概率。未知成本不产生金额，资金占用不等于亏损。
- 最晚启动日期由首次跌破安全库存日期减相应完整周期得出；早于分析日标记已过期。计划期末仍无越界则日期为空。

完整 JSON 包含 `asOf,sales,inventory,pipeline`，还可设置 `routes.US/DE`、`overrides` 和 `productSignals`：

```json
{
  "US|款号": {
    "source": "multi",
    "topCreatorShare": 35,
    "contribution": 7.2,
    "unitCost": 6,
    "airExtra": 3,
    "recoveryPct": 60,
    "demandMultiplier": 1,
    "contentPlan": "未来两周持续发布",
    "discontinued": false,
    "actionOverride": "hold"
  }
}
```

以上为 `productSignals` 字段示例，金额 US 为 USD、DE 为 EUR，不换汇。`overrides` 示例 `{"US|款号":"B"}`。source 为 unknown/multi/single/organic/ads/campaign；actionOverride 为 grow/hold/reduce/stop；内容备注不会自动提高需求。未知金额省略或 null。导出的工作区可编辑这些字段后重新导入。

## 当前范围

已包含模板表格导入、确定性计算、独立浏览器保存及团队主机共享保存、版本冲突保护和导出。尚无原始 TikTok/领星不同导出格式的自动字段映射、个人角色权限、云端持久化或真实 API 连接。不自动执行采购、创建货运单或写入ERP；MOQ、箱规、国内供给和预算约束尚未计入。没有真实业务文件时不生成伪真实补货结论。

规则参考 `plan-tiktok-replenishment` 技能的数据契约与规划说明；技能包的引擎脚本资源本次无法读取，因此仓库包含独立、已测试的初版引擎 `src/engine.js`，尚未与外部旧网页或技能脚本同步。此任务未发布或修改旧网页。
