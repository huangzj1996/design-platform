# 设计稿 DSL v2

设计稿以 JSON 保存有序的元素树。原生 v2 支持 `frame`、`rectangle`、`ellipse`、`text` 和 `icon` 五类元素。

## 文档与校验

| 根字段      | 约定                                        |
| ----------- | ------------------------------------------- |
| `version`   | 必填，数值 `2`                              |
| `children`  | 必填，有序的顶层元素数组，可以为空          |
| `variables` | 可选，文档变量映射。省略时校验结果补为 `{}` |
| `filePath`  | 可选，设计稿对应的操作系统绝对路径          |

`parseDesignDocument` 将 JSON 解析为值，再调用 `validateDesignDocument`。校验依次检查 JSON 语法、版本、字段和文档规则。字段按根、元素类型和嵌套对象各自的白名单检查。原生 v1 在 `$.version` 返回 `unsupported_version`。

校验成功时，结果保留声明的字段、数组顺序和原始变量引用。可选字段保持省略，默认值在使用字段时生效。失败时，每条 `Diagnostic` 包含 `code`、`path` 和 `message`。路径以 `$` 开头，例如 `$.children[0].textStyle.width`。

旧尺寸对象、平铺文字字段、`strokeWidth`、`strokeAlignment`、`visible`、`enabled`、`fillOpacity` 和 `clipContent` 均不属于 v2 白名单。

## 公共属性

| 字段                                       | 类型与行为                                                                               |
| ------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `id`                                       | 必填，非空字符串，在整棵元素树中唯一                                                     |
| `type`                                     | 必填，`frame`、`rectangle`、`ellipse`、`text` 或 `icon`                                  |
| `name`                                     | 字符串或引用，省略时按元素类型显示名称                                                   |
| `x`、`y`                                   | 有限数值或引用，默认 `0`。顶层元素以画布为原点，自由布局的子元素以容器内容区左上角为原点 |
| `rotation`                                 | 有限数值或引用，单位为度，默认 `0`                                                       |
| `opacity`                                  | `0` 到 `1` 的数值或引用，默认 `1`，作用于整个元素                                        |
| `fill`、`stroke`、`cornerRadius`、`effect` | 可选，见下文的外观值                                                                     |

### 尺寸

Frame、Rectangle、Ellipse 和 Icon 在元素上声明 `width` 和 `height`。Text 在 `textStyle` 内声明这两个字段，并由 `textGrowth` 决定生效的轴。

宽高接受有限非负数值、数值变量引用或尺寸模式字面值。 `fit_content` 取可计算的内容尺寸，`fill_container` 取父内容区可分配的空间。参与布局的轴缺少有效尺寸依据或出现同轴循环依赖时，校验器在相应的尺寸路径上返回 `missing_size_basis`。

### Frame

Frame 是唯一支持 `children` 的元素。子元素按声明顺序保存，`children` 省略时视为空数组。

| 字段             | 值与默认行为                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------ |
| `layout`         | `none`、`horizontal`、`vertical`，默认 `horizontal`。`none` 使用自由定位，自动布局按子元素顺序排列     |
| `gap`            | 非负数值或引用，默认 `0`                                                                               |
| `padding`        | 一个、两个或四个非负数值或引用，默认 `0`。标量用于四边，二项数组为上下、左右，四项数组为上、右、下、左 |
| `justifyContent` | `start`、`center`、`end`、`space_between`、`space_around`，默认 `start`                                |
| `alignItems`     | `start`、`center`、`end`、`stretch`，默认 `start`                                                      |
| `clip`           | 布尔值或引用，默认 `false`。开启时裁剪超出容器边界的子内容，布局使用同一尺寸依据                       |

自动布局中的 `stretch` 拉伸省略交叉轴尺寸的子元素。水平布局的交叉轴是高度，垂直布局的交叉轴是宽度。显式数值、`fit_content` 和 `fill_container` 按各自的尺寸规则计算，Text 由 `textGrowth` 决定有效尺寸。

### Text

`textStyle` 是必填对象，包含内容、排版和尺寸。

| `textStyle` 字段  | 值与默认行为                                             |
| ----------------- | -------------------------------------------------------- |
| `content`         | 必填字符串或引用，允许空字符串                           |
| `textGrowth`      | `auto`、`fixed-width`、`fixed-width-height`，默认 `auto` |
| `width`、`height` | 数值、数值变量引用或尺寸模式。必填条件见下表             |
| `fontFamily`      | 可选非空字符串或引用                                     |
| `fontSize`        | 可选正数或引用                                           |
| `fontWeight`      | 可选 1–1000 的整数或引用                                 |
| `lineHeight`      | 可选正数或引用，表示字号的倍数                           |
| `textAlign`       | `left`、`center`、`right`、`justify`，默认 `left`        |

| `textGrowth`         | 尺寸与换行                                           |
| -------------------- | ---------------------------------------------------- |
| `auto`               | 宽高由文字内容决定，保留手动换行                     |
| `fixed-width`        | 必须声明 `width`，按解析后的宽度换行，高度随内容增长 |
| `fixed-width-height` | 必须声明 `width` 和 `height`，按解析后的宽度换行     |

### Rectangle、Ellipse 和 Icon

Rectangle 和 Ellipse 使用公共属性及宽高字段。Icon 还必须提供非空字符串 `library` 和 `icon`，两者均可引用字符串变量。

## 外观值

<!-- cspell:words RRGGBB RRGGBBAA -->

### 圆角

五种元素均可声明 `cornerRadius`。Frame 和 Rectangle 使用它定义轮廓，省略时为直角。统一圆角使用一个有限非负数值或数值变量引用。逐角圆角使用四项数组，按左上、右上、右下、左下排列，每项为有限非负数值或数值变量引用。

### 填充与描边

元素的 `fill` 是可选的有序填充层数组，从底到顶绘制。每个填充层是带 `type` 的对象，`opacity` 可省略，范围为 0–1，默认 `1`。颜色值使用 `#RRGGBB` 或 `#RRGGBBAA`。

| 填充类型 `type` | 字段                                                                             |
| --------------- | -------------------------------------------------------------------------------- |
| `color`         | 必填 `color`                                                                     |
| `gradient`      | 必填 `gradientType` 和对应的几何字段                                             |
| `image`         | 必填字符串 `url`。`mode` 可取 `cover`、`contain`、`stretch`，默认 `cover`        |
| `shader`        | 必填字符串 `url`。可选 `uniforms` 映射，值接受有限数值、布尔值或二至四项数值元组 |

| `gradientType` | 必填几何字段                                                                       |
| -------------- | ---------------------------------------------------------------------------------- |
| `linear`       | `start`、`end`、`stops`                                                            |
| `radial`       | `center`、非负数值 `radius`、`stops`                                               |
| `angular`      | `center`、有限数值 `rotation`、`stops`                                             |
| `mesh`         | 矩形二维数组 `points`，至少两行两列。每个顶点包含范围为 0–1 的 `x`、`y` 和 `color` |

`start`、`end` 和 `center` 是含有限数值 `x`、`y` 的点，坐标相对元素边界归一化。`stops` 至少有两项，每项包含 `offset` 和 `color`。`offset` 范围为 0–1，按非递减顺序声明，允许相同偏移。网格各行列数相同，按从上到下、从左到右的顺序保存顶点。相邻四个顶点组成网格单元，单元内对颜色插值。

`stroke` 是一道可选描边。其中的 `fill` 复用元素填充层的结构，所有层共用位置、粗细和线型。

| `stroke` 字段 | 值                                        |
| ------------- | ----------------------------------------- |
| `fill`        | 必填，有序填充层数组                      |
| `alignment`   | `inner`、`center`、`outer`，默认 `center` |
| `width`       | 非负数值，默认 `1`                        |
| `style`       | `solid`、`dashed`、`dotted`，默认 `solid` |

颜色、数值、`url` 及布尔参数可以引用对应类型的变量。判别字段、枚举、数组和对象使用字面值。校验器检查解析后的变量值，并在通过校验的设计稿中保留引用、数组顺序和字段的省略状态。

### 效果

`effect` 是可选的效果数组，按声明顺序保存。每项使用字面值 `type` 选择类型，白名单包含 `type` 和下表列出的必填字段。

| `type`                          | 必填字段                                    |
| ------------------------------- | ------------------------------------------- |
| `drop_shadow`、`inner_shadow`   | `color`、`offsetX`、`offsetY`、`blurRadius` |
| `layer_blur`、`background_blur` | `radius`                                    |

颜色沿用填充的十六进制格式。偏移接受有限数值，`blurRadius` 和 `radius` 接受有限非负数值。颜色、偏移和半径可以引用对应类型的变量。校验器按字段规则检查变量的解析值，成功时保留原始引用和数组顺序。

## 变量

`variables` 中每项均含 `type` 和 `value`，支持 `color`、`number`、`string`、`boolean`。变量名由小写字母或数字分段组成，分段之间用单连字符连接。使用 `$name` 引用变量。

引用可以绑定普通字符串、布尔值、数值、颜色和复合值中的对应叶子字段，包括内边距单边、色标偏移、网格顶点和效果参数。结构判别字段、枚举、`id`、整个对象和整个数组使用字面值。校验器检查引用是否存在、声明类型是否匹配，并用目标字段的规则检查解析值。绑定错误定位到使用引用的字段。

## 示例设计稿

以下 v2 JSON 包含五类元素、自动布局、嵌套文字、多个填充层和描边层，以及圆角与阴影。

```json
{
  "version": 2,
  "variables": {
    "brand": { "type": "color", "value": "#1D4ED8" },
    "inset": { "type": "number", "value": 12 }
  },
  "children": [
    {
      "id": "card",
      "type": "frame",
      "name": "预览卡片",
      "layout": "vertical",
      "width": 360,
      "height": "fit_content",
      "gap": "$inset",
      "padding": ["$inset", 16],
      "alignItems": "start",
      "clip": true,
      "cornerRadius": 12,
      "children": [
        {
          "id": "surface",
          "type": "rectangle",
          "width": "fill_container",
          "height": 80,
          "cornerRadius": [12, 8, 4, 0],
          "fill": [
            { "type": "color", "color": "$brand" },
            {
              "type": "gradient",
              "gradientType": "mesh",
              "points": [
                [
                  { "x": 0, "y": 0, "color": "$brand" },
                  { "x": 1, "y": 0, "color": "#FFFFFF" }
                ],
                [
                  { "x": 0, "y": 1, "color": "#193783" },
                  { "x": 1, "y": 1, "color": "#CCD9FF" }
                ]
              ]
            },
            { "type": "image", "url": "texture.png", "opacity": 0.2 }
          ],
          "stroke": {
            "fill": [
              { "type": "color", "color": "#FFFFFF" },
              { "type": "color", "color": "$brand", "opacity": 0.5 }
            ],
            "alignment": "inner"
          },
          "effect": [
            {
              "type": "drop_shadow",
              "color": "#17203340",
              "offsetX": 0,
              "offsetY": 4,
              "blurRadius": "$inset"
            }
          ]
        },
        {
          "id": "badge",
          "type": "ellipse",
          "width": 24,
          "height": 24,
          "fill": [{ "type": "color", "color": "$brand" }]
        },
        {
          "id": "heading",
          "type": "text",
          "textStyle": {
            "content": "设计稿预览",
            "textGrowth": "fixed-width",
            "width": "fill_container",
            "fontSize": 18,
            "fontWeight": 600
          },
          "fill": [{ "type": "color", "color": "#172033" }]
        },
        {
          "id": "star",
          "type": "icon",
          "width": 20,
          "height": 20,
          "library": "lucide",
          "icon": "star",
          "fill": [{ "type": "color", "color": "$brand" }]
        }
      ]
    }
  ]
}
```
