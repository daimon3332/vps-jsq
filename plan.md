# 汇率转换器实施计划

1. 在 `index.html` 的主卡片下方、footer 上方新增“汇率转换器”卡片。
2. 货币顺序：USD, CNY, EUR, GBP, JPY, SGD, HKD, CAD, AUD, KRW, TWD, VND, RUB, MMK, CHF, INR, PKR。
3. 新增源货币、输入金额、目标货币、汇率展示、转换按钮、结果展示。
4. 在 `src/main.js` 新增转换器 DOM 引用、汇率获取、汇率展示、转换计算。
5. 复用 `https://open.er-api.com/v6/latest/CNY`，换算公式：`rate = rates[to] / rates[from]`。
6. 尽量复用现有 Tailwind 样式，仅补必要 CSS。
7. 验证 `npm run build`，并检查 USD → CNY 输入 8 的结果。
