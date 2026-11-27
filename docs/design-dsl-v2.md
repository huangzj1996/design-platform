# 设计稿 DSL v2

设计稿以 JSON 保存有序的元素树。画布、图层树、属性面板和代码导出插件使用同一份字段契约。v2 注册 `frame`、`rectangle`、`ellipse`、`text`、`icon` 五种元素。文字与外观属性参考 [Pencil `.pen` 2.25 schema](https://docs.pencil.dev/for-developers/the-pen-format#typescript-schema)。填充与描边使用下文的原生 v2 结构。

## 文档与校验

| 根字段 | 约定 |
| --- | --- |
| `version` | 必填，数值 `2` |
| `children` | 必填，有序的顶层元素数组，可以为空 |
| `variables` | 文档变量映射，省略时为空对象。变量类型为 `color`、`string`、`number`、`boolean` |
| `filePath` | 可选，设计稿对应的系统绝对路径 |

原生 v1 设计稿按不支持的版本拒绝，无迁移规则。`.pen` 2.25 通过导入入口转换为原生 v2，其中尺寸模式字符串映射为原生尺寸对象。原生字段按类型白名单校验。`visible`、`clipContent`、`text`、`textWrap`、`fillOpacity` 均不属于 v2 元素字段。`text` 仍是元素的类型标识。

下表中的「数值、字符串、布尔值或引用」表示允许使用对应类型的 `$name`。外观结构中的可绑定值可以出现在对象成员和数组项中。校验使用解析后的值检查类型、范围和枚举，保存时保留引用。`id` 和 `type` 始终为字面值。

## 公共属性

| 字段 | 类型与行为 |
| --- | --- |
| `id` | 必填，非空字符串，在整棵元素树中唯一 |
| `type` | 必填，`frame`、`rectangle`、`ellipse`、`text` 或 `icon` |
| `x`、`y` | 有限数值或引用，默认 `0`。顶层元素以画布为原点，自由布局的子元素以容器内容区左上角为原点。自动布局根据子元素顺序计算位置 |
| `width`、`height` | 非负数值或引用，或者 `{ "mode": "fit_content" }`、`{ "mode": "fill_container" }`。尺寸对象可带非负数值 `fallback` |
| `rotation` | 有限数值或引用，单位为度，默认 `0` |
| `opacity` | `0` 到 `1` 的数值或引用，默认 `1`，作用于整个元素 |
| `enabled` | 布尔值或引用，默认 `true`，决定元素是否进入画布和布局 |

尺寸规则沿用现有 DSL。`fit_content` 取内容尺寸，`fill_container` 取父内容区可分配的空间，无法取得对应尺寸时使用 `fallback`。文字先由 `textGrowth` 决定哪些轴使用声明的宽高。参与布局的元素必须能解析所需尺寸。[现有尺寸规则](../packages/design-schema/src/layout.ts#L268)

`enabled: false` 的元素仍保留在设计稿和图层树中，保留 `id`、层级和原始顺序。在画布上省略该元素及其子树，在自动布局中重新计算相邻元素的位置、间距、空间分配和 `fit_content` 尺寸。比如横向排列的 `A、B、C` 关闭 `B` 后按 `A、C` 排列，两者之间只剩一个 `gap`。在图层树重新启用 `B` 后，它回到 `A` 和 `C` 之间。`opacity: 0` 的元素仍然参与布局。

## 字段适用范围

| 元素 | 专有结构或内容字段 | 外观字段 |
| --- | --- | --- |
| `frame` | `children`、`layout`、`gap`、`padding`、`justifyContent`、`alignItems`、`clip` | `fill`、`effect`、`stroke`、`cornerRadius` |
| `rectangle` | — | `fill`、`effect`、`stroke`、`cornerRadius` |
| `ellipse` | `innerRadius`、`startAngle`、`sweepAngle` | `fill`、`effect`、`stroke`、`cornerRadius` |
| `text` | `content`、`textGrowth`、`fontFamily`、`fontSize`、`fontWeight`、`fontStyle`、`lineHeight`、`letterSpacing`、`textAlign`、`textAlignVertical`、`underline`、`strikethrough`、`href` | `fill`、`effect`、`stroke`、`cornerRadius` |
| `icon` | `library`、`icon` | `fill`、`effect`、`stroke`、`cornerRadius`、`weight` |

### 容器与矩形

`frame` 是唯一支持 `children` 的元素。`children` 可省略，省略时视为空数组。

| 容器字段 | 值与默认行为 |
| --- | --- |
| `layout` | `none`、`horizontal`、`vertical`，默认 `horizontal`。`none` 使用自由定位 |
| `gap` | 非负数值或引用，默认 `0` |
| `padding` | 上、右、下、左四个非负数值，默认 `[0, 0, 0, 0]` |
| `justifyContent` | `start`、`center`、`end`、`space_between`、`space_around`，默认 `start` |
| `alignItems` | `start`、`center`、`end`，默认 `start` |
| `clip` | 布尔值或引用，默认 `false`。开启时裁剪超出容器边界的子内容，不改变布局结果 |

### 椭圆

| 字段 | 值与默认行为 |
| --- | --- |
| `innerRadius` | 内外半径比，`0` 到 `1` 的数值或引用，默认 `0`。大于 `0` 时挖出中心 |
| `startAngle` | 数值或引用。从椭圆右侧起逆时针计角，默认 `0` 度 |
| `sweepAngle` | `-360` 到 `360` 的数值或引用，默认 `360` 度。正值逆时针，负值顺时针 |

省略三项时得到完整椭圆。`innerRadius: 0.6` 配合 `sweepAngle: 360` 得到圆环或椭圆环，缩短扫过的角度可得到弧形。

### 文字

| 字段 | 值与默认行为 |
| --- | --- |
| `content` | 可选字符串或引用。省略时按空文本处理 |
| `textGrowth` | `auto`、`fixed-width`、`fixed-width-height`，默认 `auto` |
| `fontFamily`、`fontWeight`、`fontStyle` | 字符串或引用。字重以字符串表达，例如 `"400"` 或 `"bold"` |
| `fontSize`、`letterSpacing` | 数值或引用 |
| `lineHeight` | 数值或引用，为字号的倍数。省略时使用字体的默认行高 |
| `textAlign` | `left`、`center`、`right`、`justify` |
| `textAlignVertical` | `top`、`middle`、`bottom` |
| `underline`、`strikethrough` | 布尔值或引用 |
| `href` | 字符串，文字链接目标 |

| `textGrowth` | 尺寸与换行 |
| --- | --- |
| `auto` | 按文字内容计算宽高，不自动换行，声明的 `width` 和 `height` 不生效 |
| `fixed-width` | 使用 `width` 并自动换行，高度随内容增长 |
| `fixed-width-height` | 使用 `width`、`height` 并自动换行，内容可能超出文字框 |

### 图标

`library` 和 `icon` 必填，接受非空字符串或对应的引用。`weight` 是 `100` 到 `700` 的数值或引用，仅对支持可变字重的图标库生效。`fill` 用于图标着色。

## 外观值

### 圆角

五种元素均可声明 `cornerRadius`。Frame 和 Rectangle 使用它定义轮廓，省略时为直角。统一圆角使用一个有限非负数值或数值变量引用。逐角圆角使用四项数组，按左上、右上、右下、左下排列，每项为有限非负数值或数值变量引用。

### 填充与描边

元素的 `fill` 是可选的有序填充层数组，从底到顶绘制。每个填充层是带 `type` 的对象，`opacity` 可省略，范围为 0–1，默认 `1`。颜色值使用 `#RRGGBB` 或 `#RRGGBBAA`。

| 填充类型 `type` | 字段 |
| --- | --- |
| `color` | 必填 `color` |
| `gradient` | 必填 `gradientType` 和对应的几何字段 |
| `image` | 必填字符串 `url`。`mode` 可取 `cover`、`contain`、`stretch`，默认 `cover` |
| `shader` | 必填字符串 `url`。可选 `uniforms` 映射，值接受有限数值、布尔值或二至四项数值元组 |

| `gradientType` | 必填几何字段 |
| --- | --- |
| `linear` | `start`、`end`、`stops` |
| `radial` | `center`、非负数值 `radius`、`stops` |
| `angular` | `center`、有限数值 `rotation`、`stops` |
| `mesh` | 矩形二维数组 `points`，至少两行两列。每个顶点包含范围为 0–1 的 `x`、`y` 和 `color` |

`start`、`end` 和 `center` 是含有限数值 `x`、`y` 的点，坐标相对元素边界。`stops` 至少有两项，每项包含 `offset` 和 `color`。`offset` 范围为 0–1，按非递减顺序声明，允许相同偏移。

`stroke` 是一道可选描边。其中的 `fill` 复用元素填充层的结构，所有层共用位置、粗细和线型。

| `stroke` 字段 | 值 |
| --- | --- |
| `fill` | 必填，有序填充层数组 |
| `alignment` | `inner`、`center`、`outer`，默认 `center` |
| `width` | 非负数值，默认 `1` |
| `style` | `solid`、`dashed`、`dotted`，默认 `solid` |

颜色、数值、`url` 及布尔参数可以引用对应类型的变量。判别字段、枚举、数组和对象使用字面值。校验器检查解析后的变量值，并在通过校验的设计稿中保留引用、数组顺序和字段的省略状态。

### 效果

`effect` 是可选的效果数组，按声明顺序保存。每项使用字面值 `type` 选择类型，白名单包含 `type` 和下表列出的必填字段。

| `type` | 必填字段 |
| --- | --- |
| `drop_shadow`、`inner_shadow` | `color`、`offsetX`、`offsetY`、`blurRadius` |
| `layer_blur`、`background_blur` | `radius` |

颜色沿用填充的十六进制格式。偏移接受有限数值，`blurRadius` 和 `radius` 接受有限非负数值。颜色、偏移和半径可以引用对应类型的变量。校验器按字段规则检查变量的解析值，成功时保留原始引用和数组顺序。

## 示例设计稿

以下容器包含其余四类元素。`ring` 初始关闭，图层树仍保留它。开启后，标题和图标会为它让出布局空间。

```json
{
  "version": 2,
  "variables": {
    "brand": { "type": "color", "value": "#1D4ED8" }
  },
  "children": [
    {
      "id": "card",
      "type": "frame",
      "width": 360,
      "height": { "mode": "fit_content" },
      "gap": 12,
      "padding": [12, 16, 12, 16],
      "alignItems": "center",
      "clip": true,
      "cornerRadius": 12,
      "fill": [{ "type": "color", "color": "#FFFFFF" }],
      "children": [
        {
          "id": "accent",
          "type": "rectangle",
          "width": 24,
          "height": 24,
          "cornerRadius": [12, 8, 4, 0],
          "fill": [{ "type": "color", "color": "$brand" }]
        },
        {
          "id": "ring",
          "type": "ellipse",
          "width": 24,
          "height": 24,
          "enabled": false,
          "innerRadius": 0.6,
          "sweepAngle": 270,
          "fill": [{ "type": "color", "color": "$brand" }]
        },
        {
          "id": "heading",
          "type": "text",
          "width": 180,
          "content": "设计稿预览",
          "textGrowth": "fixed-width",
          "fontSize": 18,
          "fontWeight": "600",
          "fill": [{ "type": "color", "color": "#172033" }]
        },
        {
          "id": "sparkles",
          "type": "icon",
          "width": 20,
          "height": 20,
          "library": "lucide",
          "icon": "sparkles",
          "fill": [{ "type": "color", "color": "$brand" }]
        }
      ]
    }
  ]
}
```
