# Industry Expansion Pack V2 — 建议新增细领域清单

**状态**: 建议稿 · **未实施**（本轮不得修改 `profile-registry.json` / `domain_hierarchy`）

V2 将多行业主题**映射到已注册细域**完成数据建设。下列领域在业务上独立性强，建议在后续 registry 扩展 wave 中注册为 fine domain。

| 建议 domain_id | 建议 parent | 覆盖行业 | V2 临时映射 |
|----------------|-------------|----------|-------------|
| `ecommerce_retail` | null 或 `retail` 粗域 | 电商、零售、跨境贸易 | `meeting` + `tech_ai` |
| `logistics_warehouse` | `transport` | 物流、仓储 | `transport` |
| `finance_banking` | null | 金融、银行、证券 | `meeting` |
| `insurance` | `finance_banking` 或 null | 保险 | `meeting` |
| `education` | null | 教育、培训 | `meeting` |
| `legal_gov` | null | 法律、政务 | `meeting` |
| `real_estate` | null | 房地产 | `meeting` |
| `manufacturing` | null | 制造、能源 | `transport` + `tech_ai` |
| `automotive_repair` | `transport` | 汽车、维修 | `transport` |
| `media_livestream` | null | 传媒、直播 | `meeting` |
| `customer_service` | null | 客服、呼叫中心 | `meeting` |
| `hr_payroll` | null | 人力资源、薪酬 | `meeting` |
| `agriculture` | null | 农业 | `transport` + `meeting` |
| `marketing` | null | 市场营销 | `meeting` |

## 注册前置条件（冻结流程）

1. 更新 `electron_node/electron-node/data/lexicon/profile-registry.json`
2. 执行 `lexicon:build:v2-shadow` 刷新 `domain_hierarchy`
3. 新 patch 声明 `minBundleVersion` / `requiredHierarchyVersion`
4. 不得在未注册域上直接打 `domain_tags`

## V2 已用注册域（12 个）

`tech_ai` · `meeting` · `medical` · `transport` · `tourism_hotel` · `tourism_pickup` · `tourism_route` · `tourism_transport` · `coffee` · `milk_tea` · `bakery` · `food_order`
