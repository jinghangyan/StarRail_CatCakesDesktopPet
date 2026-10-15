// 每只猫猫糕的默认名称。
// 用户可以在「右键 → 自定义名称和台词」里为每只猫改名，改写后存在本地配置里。
// 空字符串表示还没有专属名，显示为「猫猫糕 #N」。
window.PET_NAMES = {
  cake01: '垃圾糕',
  cake02: '糯米团',
  cake03: '冰糕',
  cake04: '拉姆之友',
  cake05: '芝麻酥',
  cake06: '捣乱专家',
  cake07: '藤萝饼',
  cake08: '幸运点心',
  cake09: '墨镜猫咪',
  cake10: '纯白的孩子',
  cake11: '盹盹咪',
  cake12: '太卜糍',
  cake13: '谐乐小猫',
  cake14: '蜂蜜骰子',
  cake15: '花见团子',
  cake16: '天使圣代',
  cake17: '重力酥',
  cake18: '星辰拿铁',
  cake19: '蓝莓罐子',
  cake20: '萤绒绒',
  cake21: '游戏糕手',
  cake22: '红豆牛奶',
  cake23: '蝶豆花慕斯',
  cake24: '雪顶椰椰',
  cake25: '白桃布丁',
  cake26: '薄荷提拉咪',
  cake27: '白玉青团',
};

// 名称解析：用户自定义 > 默认专属名 > 猫猫糕 #N
window.getCakeName = function (id, customNames) {
  const custom = customNames && customNames[id];
  if (custom) return custom;
  const def = window.PET_NAMES[id];
  if (def) return def;
  return '猫猫糕 #' + id.replace('cake', '');
};
