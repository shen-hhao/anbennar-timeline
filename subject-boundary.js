// Offsets, widths and dash lengths are CSS pixels at the shared reference
// camera scale. Callers apply the common boundary scale when drawing
// map-space paths. The zero-offset line is a legend sample of the original national border;
// the positive-offset line is painted only inside the subject itself.
const definitions = {
  normal: {
    kind: 'normal', labelZh: '直属附庸', pattern: 'solid',
    lines: [{ offset: 0, width: 1, dash: [] }],
  },
  union: {
    kind: 'union', labelZh: '共主邦联', pattern: 'double-solid',
    lines: [{ offset: 0, width: 1.05, dash: [] }, { offset: 2.5, width: 1.05, dash: [] }],
  },
  bodyguard: {
    kind: 'bodyguard', labelZh: '帝国卫邦', pattern: 'double-solid',
    lines: [{ offset: 0, width: 1.05, dash: [] }, { offset: 2.5, width: 1.05, dash: [] }],
  },
  puppet: {
    kind: 'puppet', labelZh: '傀儡附属国', pattern: 'double-solid',
    lines: [{ offset: 0, width: 1.05, dash: [] }, { offset: 2.5, width: 1.05, dash: [] }],
  },
  tributary: {
    kind: 'tributary', labelZh: '朝贡／行省附属', pattern: 'solid-dashed',
    lines: [{ offset: 0, width: 1.05, dash: [] }, { offset: 2.5, width: 1.05, dash: [4, 3] }],
  },
  autonomous: {
    kind: 'autonomous', labelZh: '自治及其他特殊附属', pattern: 'solid-dotted',
    lines: [{ offset: 0, width: 1.05, dash: [] }, { offset: 2.5, width: 1.1, dash: [1, 2.5] }],
  },
};

export function subjectBoundaryStyle(relation) {
  let kind = 'normal';
  if (relation?.type === 'personal_union') kind = 'union';
  else if (relation?.type === 'imperial_bodyguard') kind = 'bodyguard';
  else if (relation?.type === 'puppet') kind = 'puppet';
  else if (relation?.control === 'tributary' || /^tributary(?:_|$)/.test(relation?.type || '')) kind = 'tributary';
  else if (relation?.control === 'autonomous') kind = 'autonomous';
  const definition = definitions[kind];
  return {
    ...definition, color: '#3b4147', halo: '#ffffffdf',
    lines: definition.lines.map(line => ({ ...line, dash: [...line.dash] })),
  };
}
