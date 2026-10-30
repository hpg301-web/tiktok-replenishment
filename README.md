# StockPilot · TikTok Shop 美国和德国补货工作台

可本地运行的首版浏览器应用。美国 `/us.html`（首页默认）、德国 `/de.html` 独立保存，文件在浏览器内解析，无需 API 密钥或数据库。原初始化文件名含反引号的 README 保留不变。

## 环境和启动

推荐 Node.js 24.19.0，最低 22.12；npm 11。依赖精确版本和完整性记录保存在 `package-lock.json`。

```bash
cd /workspace/tiktok-replenishment
bash scripts/setup.sh       # npm ci + 计算测试 + 生产构建
npm run dev                 # 开发服务，端口 5173
```

```bash
npm test                    # 计算与数据边界测试（13项）
npm run build               # 输出 dist/，包括首页、美国和德国页面
npm start                   # 运行构建预览，端口 4173；需先 build
npm run test:e2e             # 浏览器功能测试，自动启动/关闭开发服务
```

浏览器测试优先使用 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`，其次使用环境已有 `/usr/bin/chromium`，否则使用 Playwright 自带浏览器。普通新机器可执行 `npx playwright install chromium` 安装；受限云环境需要允许其官方浏览器下载域名。当前环境已有系统 Chromium，无需下载或修改网络策略。单元测试使用 `--test-isolation=none` 使此运行时明确报告每个用例。

每个云任务已隔离，直接使用现有检出目录，不另建 worktree。服务进程不会随环境快照恢复，应在新任务按启动说明重启。Vite 服务仅用于开发/构建预览，生产部署应由静态托管提供 HTTPS 和访问控制。

## 首次使用

1. 选择美国或德国，设置分析日期（按店铺口径，库存为当天销售开始前）。默认日期使用 Asia/Shanghai，仅是初始值，可手动调整。
2. 可先载入明确标注的演示数据，或下载三个 CSV 模板。模板的示例行应替换为真实数据。
3. 分别导入销量、库存、在途；支持模板列名 CSV 和 XLSX 首个工作表。每次导入替换对应整表，不追加；错误文件整批拒绝，不修改已有工作区。导入真实文件时先清空演示表，避免混用。
4. 查看产品推荐动作、A/B/C策略和逐SKU海空计划；手动策略优先，按市场和产品独立保存。
5. 导出补货CSV（含风险说明和情景量），或导出/恢复 JSON 工作区备份。清除浏览器数据会丢失本地保存，请自行备份。工作区数据不跨浏览器、用户、设备或服务端口同步。

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

已包含模板表格导入、确定性计算、本地保存和导出。尚无原始 TikTok/领星不同导出格式的自动字段映射、多用户权限、云端持久化或真实 API 连接。不自动执行采购、创建货运单或写入ERP；MOQ、箱规、国内供给和预算约束尚未计入。没有真实业务文件时不生成伪真实补货结论。

规则参考 `plan-tiktok-replenishment` 技能的数据契约与规划说明；技能包的引擎脚本资源本次无法读取，因此仓库包含独立、已测试的初版引擎 `src/engine.js`，尚未与外部旧网页或技能脚本同步。此任务未发布或修改旧网页。
