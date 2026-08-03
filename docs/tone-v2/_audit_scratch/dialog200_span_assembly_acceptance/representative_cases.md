# Representative Cases Manual Review

## d002

| 字段 | 值 |
|------|-----|
| 原文 | 麻烦帮我做一杯美式带走，大杯就行，谢谢。 |
| scenario | cafe |
| windows | 75 (len1=17) |
| recall max/avg | 3 / 0.121 |
| multi-domain cand | 2 |
| edges multi-cand | 2 |
| paths | 1 (distinctSeq=1) |
| retainedDomains | coffee |
| assembly distinct | 1 |
| crossPath distinctBefore / kenlmN | 1 / 1 |
| firstCollapse | R9_ASSEMBLY_GENERATES_IDENTICAL_TEXT |
| orchMs | 42.8 |

**组装候选:**
- `麻烦帮我做一杯美式带走，大杯就行，谢谢。`

**示例 replacementOperations (NO_OP_REPLACEMENT):**
```json
[
  {
    "start": 0,
    "end": 1,
    "word": "麻",
    "sourceText": "麻",
    "candidateTerm": "麻"
  },
  {
    "start": 1,
    "end": 2,
    "word": "烦",
    "sourceText": "烦",
    "candidateTerm": "烦"
  },
  {
    "start": 2,
    "end": 3,
    "word": "帮",
    "sourceText": "帮",
    "candidateTerm": "帮"
  },
  {
    "start": 3,
    "end": 4,
    "word": "我",
    "sourceText": "我",
    "candidateTerm": "我"
  },
  {
    "start": 4,
    "end": 5,
    "word": "做",
    "sourceText": "做",
    "candidateTerm": "做"
  },
  {
    "start": 5,
    "end": 6,
    "word": "一",
    "sourceText": "一",
    "candidateTerm": "一"
  },
  {
    "start": 6,
    "end": 7,
    "word": "杯",
    "sourceText": "杯",
    "candidateTerm": "杯"
  },
  {
    "start": 7,
    "end": 9,
    "word": "美式",
    "sourceText": "美式",
    "candidateTerm": "美式"
  }
]
```

**自动启发式质量评价:** BAD

评价说明: 结构完整；多样性受 R9_ASSEMBLY_GENERATES_IDENTICAL_TEXT 限制；无金标纠错准确率。

---

## d001

| 字段 | 值 |
|------|-----|
| 原文 | 你好，我想点一杯热拿铁，中杯，少糖。顺便问一下今天有蓝莓马芬吗？ |
| scenario | cafe |
| windows | 125 (len1=27) |
| recall max/avg | 3 / 0.16 |
| multi-domain cand | 8 |
| edges multi-cand | 3 |
| paths | 2 (distinctSeq=2) |
| retainedDomains | food_order|coffee ; coffee|food_order |
| assembly distinct | 1 |
| crossPath distinctBefore / kenlmN | 1 / 1 |
| firstCollapse | R9_ASSEMBLY_GENERATES_IDENTICAL_TEXT |
| orchMs | 74.6 |

**组装候选:**
- `你好，我想点一杯热拿铁，中杯，少糖。顺便问一下今天有蓝莓马芬吗？`

**示例 replacementOperations (NO_OP_REPLACEMENT):**
```json
[
  {
    "start": 0,
    "end": 1,
    "word": "你",
    "sourceText": "你",
    "candidateTerm": "你"
  },
  {
    "start": 1,
    "end": 2,
    "word": "好",
    "sourceText": "好",
    "candidateTerm": "好"
  },
  {
    "start": 3,
    "end": 4,
    "word": "我",
    "sourceText": "我",
    "candidateTerm": "我"
  },
  {
    "start": 4,
    "end": 5,
    "word": "想",
    "sourceText": "想",
    "candidateTerm": "想"
  },
  {
    "start": 5,
    "end": 6,
    "word": "点",
    "sourceText": "点",
    "candidateTerm": "点"
  },
  {
    "start": 6,
    "end": 7,
    "word": "一",
    "sourceText": "一",
    "candidateTerm": "一"
  },
  {
    "start": 7,
    "end": 8,
    "word": "杯",
    "sourceText": "杯",
    "candidateTerm": "杯"
  },
  {
    "start": 8,
    "end": 11,
    "word": "热拿铁",
    "sourceText": "热拿铁",
    "candidateTerm": "热拿铁"
  }
]
```

**自动启发式质量评价:** BAD

评价说明: 结构完整；多样性受 R9_ASSEMBLY_GENERATES_IDENTICAL_TEXT 限制；无金标纠错准确率。

---

## d019

| 字段 | 值 |
|------|-----|
| 原文 | 今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。 |
| scenario | tech_deploy |
| windows | 180 (len1=38) |
| recall max/avg | 3 / 0.088 |
| multi-domain cand | 0 |
| edges multi-cand | 4 |
| paths | 2 (distinctSeq=2) |
| retainedDomains | tech_ai ; tech_ai |
| assembly distinct | 1 |
| crossPath distinctBefore / kenlmN | 1 / 1 |
| firstCollapse | R9_ASSEMBLY_GENERATES_IDENTICAL_TEXT |
| orchMs | 119.8 |

**组装候选:**
- `今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。`

**示例 replacementOperations (NO_OP_REPLACEMENT):**
```json
[
  {
    "start": 0,
    "end": 1,
    "word": "今",
    "sourceText": "今",
    "candidateTerm": "今"
  },
  {
    "start": 1,
    "end": 2,
    "word": "天",
    "sourceText": "天",
    "candidateTerm": "天"
  },
  {
    "start": 2,
    "end": 3,
    "word": "我",
    "sourceText": "我",
    "candidateTerm": "我"
  },
  {
    "start": 3,
    "end": 4,
    "word": "们",
    "sourceText": "们",
    "candidateTerm": "们"
  },
  {
    "start": 4,
    "end": 5,
    "word": "团",
    "sourceText": "团",
    "candidateTerm": "团"
  },
  {
    "start": 5,
    "end": 6,
    "word": "队",
    "sourceText": "队",
    "candidateTerm": "队"
  },
  {
    "start": 6,
    "end": 7,
    "word": "要",
    "sourceText": "要",
    "candidateTerm": "要"
  },
  {
    "start": 7,
    "end": 8,
    "word": "讨",
    "sourceText": "讨",
    "candidateTerm": "讨"
  }
]
```

**自动启发式质量评价:** BAD

评价说明: 结构完整；多样性受 R9_ASSEMBLY_GENERATES_IDENTICAL_TEXT 限制；无金标纠错准确率。

---

## d099

| 字段 | 值 |
|------|-----|
| 原文 | 去望京SOHO，不走机场高速可以吗？那边现在堵不堵？ |
| scenario | taxi |
| windows | 85 (len1=19) |
| recall max/avg | 3 / 0.121 |
| multi-domain cand | 2 |
| edges multi-cand | 3 |
| paths | 1 (distinctSeq=1) |
| retainedDomains | tourism_transport |
| assembly distinct | 1 |
| crossPath distinctBefore / kenlmN | 1 / 1 |
| firstCollapse | R9_ASSEMBLY_GENERATES_IDENTICAL_TEXT |
| orchMs | 47.8 |

**组装候选:**
- `去望京SOHO，不走机场高速可以吗？那边现在堵不堵？`

**示例 replacementOperations (NO_OP_REPLACEMENT):**
```json
[
  {
    "start": 0,
    "end": 1,
    "word": "去",
    "sourceText": "去",
    "candidateTerm": "去"
  },
  {
    "start": 1,
    "end": 2,
    "word": "望",
    "sourceText": "望",
    "candidateTerm": "望"
  },
  {
    "start": 2,
    "end": 3,
    "word": "京",
    "sourceText": "京",
    "candidateTerm": "京"
  },
  {
    "start": 8,
    "end": 9,
    "word": "不",
    "sourceText": "不",
    "candidateTerm": "不"
  },
  {
    "start": 9,
    "end": 10,
    "word": "走",
    "sourceText": "走",
    "candidateTerm": "走"
  },
  {
    "start": 10,
    "end": 12,
    "word": "机场",
    "sourceText": "机场",
    "candidateTerm": "机场"
  },
  {
    "start": 12,
    "end": 14,
    "word": "高速",
    "sourceText": "高速",
    "candidateTerm": "高速"
  },
  {
    "start": 14,
    "end": 16,
    "word": "可以",
    "sourceText": "可以",
    "candidateTerm": "可以"
  }
]
```

**自动启发式质量评价:** BAD

评价说明: 结构完整；多样性受 R9_ASSEMBLY_GENERATES_IDENTICAL_TEXT 限制；无金标纠错准确率。

---

## d064

| 字段 | 值 |
|------|-----|
| 原文 | 今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。 |
| scenario | tech_deploy |
| windows | 180 (len1=38) |
| recall max/avg | 3 / 0.088 |
| multi-domain cand | 0 |
| edges multi-cand | 4 |
| paths | 2 (distinctSeq=2) |
| retainedDomains | tech_ai ; tech_ai |
| assembly distinct | 1 |
| crossPath distinctBefore / kenlmN | 1 / 1 |
| firstCollapse | R9_ASSEMBLY_GENERATES_IDENTICAL_TEXT |
| orchMs | 118.5 |

**组装候选:**
- `今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。`

**示例 replacementOperations (NO_OP_REPLACEMENT):**
```json
[
  {
    "start": 0,
    "end": 1,
    "word": "今",
    "sourceText": "今",
    "candidateTerm": "今"
  },
  {
    "start": 1,
    "end": 2,
    "word": "天",
    "sourceText": "天",
    "candidateTerm": "天"
  },
  {
    "start": 2,
    "end": 3,
    "word": "我",
    "sourceText": "我",
    "candidateTerm": "我"
  },
  {
    "start": 3,
    "end": 4,
    "word": "们",
    "sourceText": "们",
    "candidateTerm": "们"
  },
  {
    "start": 4,
    "end": 5,
    "word": "团",
    "sourceText": "团",
    "candidateTerm": "团"
  },
  {
    "start": 5,
    "end": 6,
    "word": "队",
    "sourceText": "队",
    "candidateTerm": "队"
  },
  {
    "start": 6,
    "end": 7,
    "word": "要",
    "sourceText": "要",
    "candidateTerm": "要"
  },
  {
    "start": 7,
    "end": 8,
    "word": "讨",
    "sourceText": "讨",
    "candidateTerm": "讨"
  }
]
```

**自动启发式质量评价:** BAD

评价说明: 结构完整；多样性受 R9_ASSEMBLY_GENERATES_IDENTICAL_TEXT 限制；无金标纠错准确率。

---

## d109

| 字段 | 值 |
|------|-----|
| 原文 | 今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。 |
| scenario | tech_deploy |
| windows | 180 (len1=38) |
| recall max/avg | 3 / 0.088 |
| multi-domain cand | 0 |
| edges multi-cand | 4 |
| paths | 2 (distinctSeq=2) |
| retainedDomains | tech_ai ; tech_ai |
| assembly distinct | 1 |
| crossPath distinctBefore / kenlmN | 1 / 1 |
| firstCollapse | R9_ASSEMBLY_GENERATES_IDENTICAL_TEXT |
| orchMs | 124.5 |

**组装候选:**
- `今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。`

**示例 replacementOperations (NO_OP_REPLACEMENT):**
```json
[
  {
    "start": 0,
    "end": 1,
    "word": "今",
    "sourceText": "今",
    "candidateTerm": "今"
  },
  {
    "start": 1,
    "end": 2,
    "word": "天",
    "sourceText": "天",
    "candidateTerm": "天"
  },
  {
    "start": 2,
    "end": 3,
    "word": "我",
    "sourceText": "我",
    "candidateTerm": "我"
  },
  {
    "start": 3,
    "end": 4,
    "word": "们",
    "sourceText": "们",
    "candidateTerm": "们"
  },
  {
    "start": 4,
    "end": 5,
    "word": "团",
    "sourceText": "团",
    "candidateTerm": "团"
  },
  {
    "start": 5,
    "end": 6,
    "word": "队",
    "sourceText": "队",
    "candidateTerm": "队"
  },
  {
    "start": 6,
    "end": 7,
    "word": "要",
    "sourceText": "要",
    "candidateTerm": "要"
  },
  {
    "start": 7,
    "end": 8,
    "word": "讨",
    "sourceText": "讨",
    "candidateTerm": "讨"
  }
]
```

**自动启发式质量评价:** BAD

评价说明: 结构完整；多样性受 R9_ASSEMBLY_GENERATES_IDENTICAL_TEXT 限制；无金标纠错准确率。

---

## d154

| 字段 | 值 |
|------|-----|
| 原文 | 今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。 |
| scenario | tech_deploy |
| windows | 180 (len1=38) |
| recall max/avg | 3 / 0.088 |
| multi-domain cand | 0 |
| edges multi-cand | 4 |
| paths | 2 (distinctSeq=2) |
| retainedDomains | tech_ai ; tech_ai |
| assembly distinct | 1 |
| crossPath distinctBefore / kenlmN | 1 / 1 |
| firstCollapse | R9_ASSEMBLY_GENERATES_IDENTICAL_TEXT |
| orchMs | 114.3 |

**组装候选:**
- `今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。`

**示例 replacementOperations (NO_OP_REPLACEMENT):**
```json
[
  {
    "start": 0,
    "end": 1,
    "word": "今",
    "sourceText": "今",
    "candidateTerm": "今"
  },
  {
    "start": 1,
    "end": 2,
    "word": "天",
    "sourceText": "天",
    "candidateTerm": "天"
  },
  {
    "start": 2,
    "end": 3,
    "word": "我",
    "sourceText": "我",
    "candidateTerm": "我"
  },
  {
    "start": 3,
    "end": 4,
    "word": "们",
    "sourceText": "们",
    "candidateTerm": "们"
  },
  {
    "start": 4,
    "end": 5,
    "word": "团",
    "sourceText": "团",
    "candidateTerm": "团"
  },
  {
    "start": 5,
    "end": 6,
    "word": "队",
    "sourceText": "队",
    "candidateTerm": "队"
  },
  {
    "start": 6,
    "end": 7,
    "word": "要",
    "sourceText": "要",
    "candidateTerm": "要"
  },
  {
    "start": 7,
    "end": 8,
    "word": "讨",
    "sourceText": "讨",
    "candidateTerm": "讨"
  }
]
```

**自动启发式质量评价:** BAD

评价说明: 结构完整；多样性受 R9_ASSEMBLY_GENERATES_IDENTICAL_TEXT 限制；无金标纠错准确率。

---

## d199

| 字段 | 值 |
|------|-----|
| 原文 | 今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。 |
| scenario | tech_deploy |
| windows | 180 (len1=38) |
| recall max/avg | 3 / 0.088 |
| multi-domain cand | 0 |
| edges multi-cand | 4 |
| paths | 2 (distinctSeq=2) |
| retainedDomains | tech_ai ; tech_ai |
| assembly distinct | 1 |
| crossPath distinctBefore / kenlmN | 1 / 1 |
| firstCollapse | R9_ASSEMBLY_GENERATES_IDENTICAL_TEXT |
| orchMs | 107.5 |

**组装候选:**
- `今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。`

**示例 replacementOperations (NO_OP_REPLACEMENT):**
```json
[
  {
    "start": 0,
    "end": 1,
    "word": "今",
    "sourceText": "今",
    "candidateTerm": "今"
  },
  {
    "start": 1,
    "end": 2,
    "word": "天",
    "sourceText": "天",
    "candidateTerm": "天"
  },
  {
    "start": 2,
    "end": 3,
    "word": "我",
    "sourceText": "我",
    "candidateTerm": "我"
  },
  {
    "start": 3,
    "end": 4,
    "word": "们",
    "sourceText": "们",
    "candidateTerm": "们"
  },
  {
    "start": 4,
    "end": 5,
    "word": "团",
    "sourceText": "团",
    "candidateTerm": "团"
  },
  {
    "start": 5,
    "end": 6,
    "word": "队",
    "sourceText": "队",
    "candidateTerm": "队"
  },
  {
    "start": 6,
    "end": 7,
    "word": "要",
    "sourceText": "要",
    "candidateTerm": "要"
  },
  {
    "start": 7,
    "end": 8,
    "word": "讨",
    "sourceText": "讨",
    "candidateTerm": "讨"
  }
]
```

**自动启发式质量评价:** BAD

评价说明: 结构完整；多样性受 R9_ASSEMBLY_GENERATES_IDENTICAL_TEXT 限制；无金标纠错准确率。

---

## d005

| 字段 | 值 |
|------|-----|
| 原文 | 今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。 |
| scenario | meeting |
| windows | 165 (len1=35) |
| recall max/avg | 3 / 0.021 |
| multi-domain cand | 0 |
| edges multi-cand | 1 |
| paths | 1 (distinctSeq=1) |
| retainedDomains | food_order |
| assembly distinct | 1 |
| crossPath distinctBefore / kenlmN | 1 / 1 |
| firstCollapse | R9_ASSEMBLY_GENERATES_IDENTICAL_TEXT |
| orchMs | 92.4 |

**组装候选:**
- `今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。`

**示例 replacementOperations (NO_OP_REPLACEMENT):**
```json
[
  {
    "start": 0,
    "end": 1,
    "word": "今",
    "sourceText": "今",
    "candidateTerm": "今"
  },
  {
    "start": 1,
    "end": 2,
    "word": "天",
    "sourceText": "天",
    "candidateTerm": "天"
  },
  {
    "start": 2,
    "end": 3,
    "word": "的",
    "sourceText": "的",
    "candidateTerm": "的"
  },
  {
    "start": 3,
    "end": 4,
    "word": "站",
    "sourceText": "站",
    "candidateTerm": "站"
  },
  {
    "start": 4,
    "end": 5,
    "word": "会",
    "sourceText": "会",
    "candidateTerm": "会"
  },
  {
    "start": 5,
    "end": 6,
    "word": "先",
    "sourceText": "先",
    "candidateTerm": "先"
  },
  {
    "start": 6,
    "end": 7,
    "word": "过",
    "sourceText": "过",
    "candidateTerm": "过"
  },
  {
    "start": 7,
    "end": 8,
    "word": "一",
    "sourceText": "一",
    "candidateTerm": "一"
  }
]
```

**自动启发式质量评价:** BAD

评价说明: 结构完整；多样性受 R9_ASSEMBLY_GENERATES_IDENTICAL_TEXT 限制；无金标纠错准确率。

---

## d050

| 字段 | 值 |
|------|-----|
| 原文 | 今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。 |
| scenario | meeting |
| windows | 165 (len1=35) |
| recall max/avg | 3 / 0.021 |
| multi-domain cand | 0 |
| edges multi-cand | 1 |
| paths | 1 (distinctSeq=1) |
| retainedDomains | food_order |
| assembly distinct | 1 |
| crossPath distinctBefore / kenlmN | 1 / 1 |
| firstCollapse | R9_ASSEMBLY_GENERATES_IDENTICAL_TEXT |
| orchMs | 120.6 |

**组装候选:**
- `今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。`

**示例 replacementOperations (NO_OP_REPLACEMENT):**
```json
[
  {
    "start": 0,
    "end": 1,
    "word": "今",
    "sourceText": "今",
    "candidateTerm": "今"
  },
  {
    "start": 1,
    "end": 2,
    "word": "天",
    "sourceText": "天",
    "candidateTerm": "天"
  },
  {
    "start": 2,
    "end": 3,
    "word": "的",
    "sourceText": "的",
    "candidateTerm": "的"
  },
  {
    "start": 3,
    "end": 4,
    "word": "站",
    "sourceText": "站",
    "candidateTerm": "站"
  },
  {
    "start": 4,
    "end": 5,
    "word": "会",
    "sourceText": "会",
    "candidateTerm": "会"
  },
  {
    "start": 5,
    "end": 6,
    "word": "先",
    "sourceText": "先",
    "candidateTerm": "先"
  },
  {
    "start": 6,
    "end": 7,
    "word": "过",
    "sourceText": "过",
    "candidateTerm": "过"
  },
  {
    "start": 7,
    "end": 8,
    "word": "一",
    "sourceText": "一",
    "candidateTerm": "一"
  }
]
```

**自动启发式质量评价:** BAD

评价说明: 结构完整；多样性受 R9_ASSEMBLY_GENERATES_IDENTICAL_TEXT 限制；无金标纠错准确率。

---

## d095

| 字段 | 值 |
|------|-----|
| 原文 | 今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。 |
| scenario | meeting |
| windows | 165 (len1=35) |
| recall max/avg | 3 / 0.021 |
| multi-domain cand | 0 |
| edges multi-cand | 1 |
| paths | 1 (distinctSeq=1) |
| retainedDomains | food_order |
| assembly distinct | 1 |
| crossPath distinctBefore / kenlmN | 1 / 1 |
| firstCollapse | R9_ASSEMBLY_GENERATES_IDENTICAL_TEXT |
| orchMs | 115.3 |

**组装候选:**
- `今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。`

**示例 replacementOperations (NO_OP_REPLACEMENT):**
```json
[
  {
    "start": 0,
    "end": 1,
    "word": "今",
    "sourceText": "今",
    "candidateTerm": "今"
  },
  {
    "start": 1,
    "end": 2,
    "word": "天",
    "sourceText": "天",
    "candidateTerm": "天"
  },
  {
    "start": 2,
    "end": 3,
    "word": "的",
    "sourceText": "的",
    "candidateTerm": "的"
  },
  {
    "start": 3,
    "end": 4,
    "word": "站",
    "sourceText": "站",
    "candidateTerm": "站"
  },
  {
    "start": 4,
    "end": 5,
    "word": "会",
    "sourceText": "会",
    "candidateTerm": "会"
  },
  {
    "start": 5,
    "end": 6,
    "word": "先",
    "sourceText": "先",
    "candidateTerm": "先"
  },
  {
    "start": 6,
    "end": 7,
    "word": "过",
    "sourceText": "过",
    "candidateTerm": "过"
  },
  {
    "start": 7,
    "end": 8,
    "word": "一",
    "sourceText": "一",
    "candidateTerm": "一"
  }
]
```

**自动启发式质量评价:** BAD

评价说明: 结构完整；多样性受 R9_ASSEMBLY_GENERATES_IDENTICAL_TEXT 限制；无金标纠错准确率。

---

## d140

| 字段 | 值 |
|------|-----|
| 原文 | 今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。 |
| scenario | meeting |
| windows | 165 (len1=35) |
| recall max/avg | 3 / 0.021 |
| multi-domain cand | 0 |
| edges multi-cand | 1 |
| paths | 1 (distinctSeq=1) |
| retainedDomains | food_order |
| assembly distinct | 1 |
| crossPath distinctBefore / kenlmN | 1 / 1 |
| firstCollapse | R9_ASSEMBLY_GENERATES_IDENTICAL_TEXT |
| orchMs | 102.1 |

**组装候选:**
- `今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。`

**示例 replacementOperations (NO_OP_REPLACEMENT):**
```json
[
  {
    "start": 0,
    "end": 1,
    "word": "今",
    "sourceText": "今",
    "candidateTerm": "今"
  },
  {
    "start": 1,
    "end": 2,
    "word": "天",
    "sourceText": "天",
    "candidateTerm": "天"
  },
  {
    "start": 2,
    "end": 3,
    "word": "的",
    "sourceText": "的",
    "candidateTerm": "的"
  },
  {
    "start": 3,
    "end": 4,
    "word": "站",
    "sourceText": "站",
    "candidateTerm": "站"
  },
  {
    "start": 4,
    "end": 5,
    "word": "会",
    "sourceText": "会",
    "candidateTerm": "会"
  },
  {
    "start": 5,
    "end": 6,
    "word": "先",
    "sourceText": "先",
    "candidateTerm": "先"
  },
  {
    "start": 6,
    "end": 7,
    "word": "过",
    "sourceText": "过",
    "candidateTerm": "过"
  },
  {
    "start": 7,
    "end": 8,
    "word": "一",
    "sourceText": "一",
    "candidateTerm": "一"
  }
]
```

**自动启发式质量评价:** BAD

评价说明: 结构完整；多样性受 R9_ASSEMBLY_GENERATES_IDENTICAL_TEXT 限制；无金标纠错准确率。

---

## d185

| 字段 | 值 |
|------|-----|
| 原文 | 今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。 |
| scenario | meeting |
| windows | 165 (len1=35) |
| recall max/avg | 3 / 0.021 |
| multi-domain cand | 0 |
| edges multi-cand | 1 |
| paths | 1 (distinctSeq=1) |
| retainedDomains | food_order |
| assembly distinct | 1 |
| crossPath distinctBefore / kenlmN | 1 / 1 |
| firstCollapse | R9_ASSEMBLY_GENERATES_IDENTICAL_TEXT |
| orchMs | 109.6 |

**组装候选:**
- `今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。`

**示例 replacementOperations (NO_OP_REPLACEMENT):**
```json
[
  {
    "start": 0,
    "end": 1,
    "word": "今",
    "sourceText": "今",
    "candidateTerm": "今"
  },
  {
    "start": 1,
    "end": 2,
    "word": "天",
    "sourceText": "天",
    "candidateTerm": "天"
  },
  {
    "start": 2,
    "end": 3,
    "word": "的",
    "sourceText": "的",
    "candidateTerm": "的"
  },
  {
    "start": 3,
    "end": 4,
    "word": "站",
    "sourceText": "站",
    "candidateTerm": "站"
  },
  {
    "start": 4,
    "end": 5,
    "word": "会",
    "sourceText": "会",
    "candidateTerm": "会"
  },
  {
    "start": 5,
    "end": 6,
    "word": "先",
    "sourceText": "先",
    "candidateTerm": "先"
  },
  {
    "start": 6,
    "end": 7,
    "word": "过",
    "sourceText": "过",
    "candidateTerm": "过"
  },
  {
    "start": 7,
    "end": 8,
    "word": "一",
    "sourceText": "一",
    "candidateTerm": "一"
  }
]
```

**自动启发式质量评价:** BAD

评价说明: 结构完整；多样性受 R9_ASSEMBLY_GENERATES_IDENTICAL_TEXT 限制；无金标纠错准确率。

---

## d004

| 字段 | 值 |
|------|-----|
| 原文 | 小陈，客户反馈翻译引擎接口报错，我们能不能加缓存，下午三点前把结论发群里？ |
| scenario | meeting |
| windows | 155 (len1=33) |
| recall max/avg | 3 / 0.063 |
| multi-domain cand | 0 |
| edges multi-cand | 2 |
| paths | 1 (distinctSeq=1) |
| retainedDomains | tech_ai |
| assembly distinct | 1 |
| crossPath distinctBefore / kenlmN | 1 / 1 |
| firstCollapse | R9_ASSEMBLY_GENERATES_IDENTICAL_TEXT |
| orchMs | 78.9 |

**组装候选:**
- `小陈，客户反馈翻译引擎接口报错，我们能不能加缓存，下午三点前把结论发群里？`

**示例 replacementOperations (NO_OP_REPLACEMENT):**
```json
[
  {
    "start": 0,
    "end": 1,
    "word": "小",
    "sourceText": "小",
    "candidateTerm": "小"
  },
  {
    "start": 1,
    "end": 2,
    "word": "陈",
    "sourceText": "陈",
    "candidateTerm": "陈"
  },
  {
    "start": 3,
    "end": 4,
    "word": "客",
    "sourceText": "客",
    "candidateTerm": "客"
  },
  {
    "start": 4,
    "end": 5,
    "word": "户",
    "sourceText": "户",
    "candidateTerm": "户"
  },
  {
    "start": 5,
    "end": 6,
    "word": "反",
    "sourceText": "反",
    "candidateTerm": "反"
  },
  {
    "start": 6,
    "end": 7,
    "word": "馈",
    "sourceText": "馈",
    "candidateTerm": "馈"
  },
  {
    "start": 7,
    "end": 9,
    "word": "翻译",
    "sourceText": "翻译",
    "candidateTerm": "翻译"
  },
  {
    "start": 9,
    "end": 11,
    "word": "引擎",
    "sourceText": "引擎",
    "candidateTerm": "引擎"
  }
]
```

**自动启发式质量评价:** BAD

评价说明: 结构完整；多样性受 R9_ASSEMBLY_GENERATES_IDENTICAL_TEXT 限制；无金标纠错准确率。

---

## d049

| 字段 | 值 |
|------|-----|
| 原文 | 李工，客户反馈翻译引擎接口报错，我们能不能加缓存，下午三点前把结论发群里？ |
| scenario | meeting |
| windows | 155 (len1=33) |
| recall max/avg | 3 / 0.063 |
| multi-domain cand | 0 |
| edges multi-cand | 2 |
| paths | 1 (distinctSeq=1) |
| retainedDomains | tech_ai |
| assembly distinct | 1 |
| crossPath distinctBefore / kenlmN | 1 / 1 |
| firstCollapse | R9_ASSEMBLY_GENERATES_IDENTICAL_TEXT |
| orchMs | 92.2 |

**组装候选:**
- `李工，客户反馈翻译引擎接口报错，我们能不能加缓存，下午三点前把结论发群里？`

**示例 replacementOperations (NO_OP_REPLACEMENT):**
```json
[
  {
    "start": 0,
    "end": 1,
    "word": "李",
    "sourceText": "李",
    "candidateTerm": "李"
  },
  {
    "start": 1,
    "end": 2,
    "word": "工",
    "sourceText": "工",
    "candidateTerm": "工"
  },
  {
    "start": 3,
    "end": 4,
    "word": "客",
    "sourceText": "客",
    "candidateTerm": "客"
  },
  {
    "start": 4,
    "end": 5,
    "word": "户",
    "sourceText": "户",
    "candidateTerm": "户"
  },
  {
    "start": 5,
    "end": 6,
    "word": "反",
    "sourceText": "反",
    "candidateTerm": "反"
  },
  {
    "start": 6,
    "end": 7,
    "word": "馈",
    "sourceText": "馈",
    "candidateTerm": "馈"
  },
  {
    "start": 7,
    "end": 9,
    "word": "翻译",
    "sourceText": "翻译",
    "candidateTerm": "翻译"
  },
  {
    "start": 9,
    "end": 11,
    "word": "引擎",
    "sourceText": "引擎",
    "candidateTerm": "引擎"
  }
]
```

**自动启发式质量评价:** BAD

评价说明: 结构完整；多样性受 R9_ASSEMBLY_GENERATES_IDENTICAL_TEXT 限制；无金标纠错准确率。

---

## d094

| 字段 | 值 |
|------|-----|
| 原文 | 小陈，客户反馈翻译引擎接口报错，我们能不能加缓存，下午三点前把结论发群里？ |
| scenario | meeting |
| windows | 155 (len1=33) |
| recall max/avg | 3 / 0.063 |
| multi-domain cand | 0 |
| edges multi-cand | 2 |
| paths | 1 (distinctSeq=1) |
| retainedDomains | tech_ai |
| assembly distinct | 1 |
| crossPath distinctBefore / kenlmN | 1 / 1 |
| firstCollapse | R9_ASSEMBLY_GENERATES_IDENTICAL_TEXT |
| orchMs | 100.5 |

**组装候选:**
- `小陈，客户反馈翻译引擎接口报错，我们能不能加缓存，下午三点前把结论发群里？`

**示例 replacementOperations (NO_OP_REPLACEMENT):**
```json
[
  {
    "start": 0,
    "end": 1,
    "word": "小",
    "sourceText": "小",
    "candidateTerm": "小"
  },
  {
    "start": 1,
    "end": 2,
    "word": "陈",
    "sourceText": "陈",
    "candidateTerm": "陈"
  },
  {
    "start": 3,
    "end": 4,
    "word": "客",
    "sourceText": "客",
    "candidateTerm": "客"
  },
  {
    "start": 4,
    "end": 5,
    "word": "户",
    "sourceText": "户",
    "candidateTerm": "户"
  },
  {
    "start": 5,
    "end": 6,
    "word": "反",
    "sourceText": "反",
    "candidateTerm": "反"
  },
  {
    "start": 6,
    "end": 7,
    "word": "馈",
    "sourceText": "馈",
    "candidateTerm": "馈"
  },
  {
    "start": 7,
    "end": 9,
    "word": "翻译",
    "sourceText": "翻译",
    "candidateTerm": "翻译"
  },
  {
    "start": 9,
    "end": 11,
    "word": "引擎",
    "sourceText": "引擎",
    "candidateTerm": "引擎"
  }
]
```

**自动启发式质量评价:** BAD

评价说明: 结构完整；多样性受 R9_ASSEMBLY_GENERATES_IDENTICAL_TEXT 限制；无金标纠错准确率。

---

## d139

| 字段 | 值 |
|------|-----|
| 原文 | 李工，客户反馈翻译引擎接口报错，我们能不能加缓存，下午三点前把结论发群里？ |
| scenario | meeting |
| windows | 155 (len1=33) |
| recall max/avg | 3 / 0.063 |
| multi-domain cand | 0 |
| edges multi-cand | 2 |
| paths | 1 (distinctSeq=1) |
| retainedDomains | tech_ai |
| assembly distinct | 1 |
| crossPath distinctBefore / kenlmN | 1 / 1 |
| firstCollapse | R9_ASSEMBLY_GENERATES_IDENTICAL_TEXT |
| orchMs | 93.4 |

**组装候选:**
- `李工，客户反馈翻译引擎接口报错，我们能不能加缓存，下午三点前把结论发群里？`

**示例 replacementOperations (NO_OP_REPLACEMENT):**
```json
[
  {
    "start": 0,
    "end": 1,
    "word": "李",
    "sourceText": "李",
    "candidateTerm": "李"
  },
  {
    "start": 1,
    "end": 2,
    "word": "工",
    "sourceText": "工",
    "candidateTerm": "工"
  },
  {
    "start": 3,
    "end": 4,
    "word": "客",
    "sourceText": "客",
    "candidateTerm": "客"
  },
  {
    "start": 4,
    "end": 5,
    "word": "户",
    "sourceText": "户",
    "candidateTerm": "户"
  },
  {
    "start": 5,
    "end": 6,
    "word": "反",
    "sourceText": "反",
    "candidateTerm": "反"
  },
  {
    "start": 6,
    "end": 7,
    "word": "馈",
    "sourceText": "馈",
    "candidateTerm": "馈"
  },
  {
    "start": 7,
    "end": 9,
    "word": "翻译",
    "sourceText": "翻译",
    "candidateTerm": "翻译"
  },
  {
    "start": 9,
    "end": 11,
    "word": "引擎",
    "sourceText": "引擎",
    "candidateTerm": "引擎"
  }
]
```

**自动启发式质量评价:** BAD

评价说明: 结构完整；多样性受 R9_ASSEMBLY_GENERATES_IDENTICAL_TEXT 限制；无金标纠错准确率。

---

## d184

| 字段 | 值 |
|------|-----|
| 原文 | 小陈，客户反馈翻译引擎接口报错，我们能不能加缓存，下午三点前把结论发群里？ |
| scenario | meeting |
| windows | 155 (len1=33) |
| recall max/avg | 3 / 0.063 |
| multi-domain cand | 0 |
| edges multi-cand | 2 |
| paths | 1 (distinctSeq=1) |
| retainedDomains | tech_ai |
| assembly distinct | 1 |
| crossPath distinctBefore / kenlmN | 1 / 1 |
| firstCollapse | R9_ASSEMBLY_GENERATES_IDENTICAL_TEXT |
| orchMs | 85.8 |

**组装候选:**
- `小陈，客户反馈翻译引擎接口报错，我们能不能加缓存，下午三点前把结论发群里？`

**示例 replacementOperations (NO_OP_REPLACEMENT):**
```json
[
  {
    "start": 0,
    "end": 1,
    "word": "小",
    "sourceText": "小",
    "candidateTerm": "小"
  },
  {
    "start": 1,
    "end": 2,
    "word": "陈",
    "sourceText": "陈",
    "candidateTerm": "陈"
  },
  {
    "start": 3,
    "end": 4,
    "word": "客",
    "sourceText": "客",
    "candidateTerm": "客"
  },
  {
    "start": 4,
    "end": 5,
    "word": "户",
    "sourceText": "户",
    "candidateTerm": "户"
  },
  {
    "start": 5,
    "end": 6,
    "word": "反",
    "sourceText": "反",
    "candidateTerm": "反"
  },
  {
    "start": 6,
    "end": 7,
    "word": "馈",
    "sourceText": "馈",
    "candidateTerm": "馈"
  },
  {
    "start": 7,
    "end": 9,
    "word": "翻译",
    "sourceText": "翻译",
    "candidateTerm": "翻译"
  },
  {
    "start": 9,
    "end": 11,
    "word": "引擎",
    "sourceText": "引擎",
    "candidateTerm": "引擎"
  }
]
```

**自动启发式质量评价:** BAD

评价说明: 结构完整；多样性受 R9_ASSEMBLY_GENERATES_IDENTICAL_TEXT 限制；无金标纠错准确率。

---

## d007

| 字段 | 值 |
|------|-----|
| 原文 | 师傅，去中关村软件园，走机场高速。我赶九点半的会，要是堵车您提前跟我说。 |
| scenario | taxi |
| windows | 145 (len1=31) |
| recall max/avg | 3 / 0.093 |
| multi-domain cand | 2 |
| edges multi-cand | 3 |
| paths | 1 (distinctSeq=1) |
| retainedDomains | tourism_hotel|tourism_transport |
| assembly distinct | 1 |
| crossPath distinctBefore / kenlmN | 1 / 1 |
| firstCollapse | R9_ASSEMBLY_GENERATES_IDENTICAL_TEXT |
| orchMs | 63.1 |

**组装候选:**
- `师傅，去中关村软件园，走机场高速。我赶九点半的会，要是堵车您提前跟我说。`

**示例 replacementOperations (NO_OP_REPLACEMENT):**
```json
[
  {
    "start": 0,
    "end": 1,
    "word": "师",
    "sourceText": "师",
    "candidateTerm": "师"
  },
  {
    "start": 1,
    "end": 2,
    "word": "傅",
    "sourceText": "傅",
    "candidateTerm": "傅"
  },
  {
    "start": 3,
    "end": 4,
    "word": "去",
    "sourceText": "去",
    "candidateTerm": "去"
  },
  {
    "start": 4,
    "end": 5,
    "word": "中",
    "sourceText": "中",
    "candidateTerm": "中"
  },
  {
    "start": 5,
    "end": 6,
    "word": "关",
    "sourceText": "关",
    "candidateTerm": "关"
  },
  {
    "start": 6,
    "end": 7,
    "word": "村",
    "sourceText": "村",
    "candidateTerm": "村"
  },
  {
    "start": 7,
    "end": 9,
    "word": "软件",
    "sourceText": "软件",
    "candidateTerm": "软件"
  },
  {
    "start": 9,
    "end": 10,
    "word": "园",
    "sourceText": "园",
    "candidateTerm": "园"
  }
]
```

**自动启发式质量评价:** BAD

评价说明: 结构完整；多样性受 R9_ASSEMBLY_GENERATES_IDENTICAL_TEXT 限制；无金标纠错准确率。

---

## d187

| 字段 | 值 |
|------|-----|
| 原文 | 师傅，去中关村软件园，走机场高速。我赶九点半的会，要是堵车您提前跟我说。 |
| scenario | taxi |
| windows | 145 (len1=31) |
| recall max/avg | 3 / 0.093 |
| multi-domain cand | 2 |
| edges multi-cand | 3 |
| paths | 1 (distinctSeq=1) |
| retainedDomains | tourism_hotel|tourism_transport |
| assembly distinct | 1 |
| crossPath distinctBefore / kenlmN | 1 / 1 |
| firstCollapse | R9_ASSEMBLY_GENERATES_IDENTICAL_TEXT |
| orchMs | 76.9 |

**组装候选:**
- `师傅，去中关村软件园，走机场高速。我赶九点半的会，要是堵车您提前跟我说。`

**示例 replacementOperations (NO_OP_REPLACEMENT):**
```json
[
  {
    "start": 0,
    "end": 1,
    "word": "师",
    "sourceText": "师",
    "candidateTerm": "师"
  },
  {
    "start": 1,
    "end": 2,
    "word": "傅",
    "sourceText": "傅",
    "candidateTerm": "傅"
  },
  {
    "start": 3,
    "end": 4,
    "word": "去",
    "sourceText": "去",
    "candidateTerm": "去"
  },
  {
    "start": 4,
    "end": 5,
    "word": "中",
    "sourceText": "中",
    "candidateTerm": "中"
  },
  {
    "start": 5,
    "end": 6,
    "word": "关",
    "sourceText": "关",
    "candidateTerm": "关"
  },
  {
    "start": 6,
    "end": 7,
    "word": "村",
    "sourceText": "村",
    "candidateTerm": "村"
  },
  {
    "start": 7,
    "end": 9,
    "word": "软件",
    "sourceText": "软件",
    "candidateTerm": "软件"
  },
  {
    "start": 9,
    "end": 10,
    "word": "园",
    "sourceText": "园",
    "candidateTerm": "园"
  }
]
```

**自动启发式质量评价:** BAD

评价说明: 结构完整；多样性受 R9_ASSEMBLY_GENERATES_IDENTICAL_TEXT 限制；无金标纠错准确率。

---

