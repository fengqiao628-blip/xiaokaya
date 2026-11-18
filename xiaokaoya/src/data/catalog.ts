import type { Subject, SubjectPart, Quote } from '../domain/models'
export const subjects: Subject[] = [
  ...['会计', '审计', '财务成本管理', '公司战略与风险管理', '经济法', '税法'].map((name, i) => ({
    id: `cpa-${i + 1}`,
    name,
    system: 'cpa' as const,
    stage: 'professional' as const,
    order: i,
  })),
  {
    id: 'cpa-comprehensive',
    name: '职业能力综合测试',
    system: 'cpa',
    stage: 'comprehensive',
    order: 6,
  },
  ...['税法（一）', '税法（二）', '涉税服务实务', '涉税服务相关法律', '财务与会计'].map(
    (name, i) => ({
      id: `tax-${i + 1}`,
      name,
      system: 'tax' as const,
      stage: 'tax' as const,
      order: i + 7,
    }),
  ),
]
export const subjectParts: SubjectPart[] = [
  { id: 'cpa-comprehensive-1', subjectId: 'cpa-comprehensive', name: '试卷一' },
  { id: 'cpa-comprehensive-2', subjectId: 'cpa-comprehensive', name: '试卷二' },
]
export const quotes: Quote[] = [
  { id: 'q1', text: '不用一下子很厉害，每天进步一点点就很好。', category: '慢慢成长' },
  { id: 'q2', text: '认真走过的每一小步，都会成为你的底气。', category: '温柔陪伴' },
  { id: 'q3', text: '今天学会的一点点，都是送给未来自己的礼物。', category: '慢慢成长' },
  { id: 'q4', text: '允许自己慢一点，也记得为自己鼓掌。', category: '温柔陪伴' },
  { id: 'q5', text: '把大大的目标，交给小小的日常。', category: '轻松出发' },
  { id: 'q6', text: '翻过这一页，你又比昨天多懂了一点。', category: '轻松出发' },
  { id: 'q7', text: '休息也是旅程的一部分，充好电再出发。', category: '安心休息' },
  { id: 'q8', text: '你正在用自己的节奏，慢慢靠近想去的地方。', category: '温柔陪伴' },
]
