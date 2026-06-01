const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

const TMPL_ID = '5jq7RwQHoM3KUL18Smm3x0FxtsCpEZFWqelsnxckzwk'

const MEAL_MAP = {
  breakfast: '早餐',
  lunch: '午餐',
  afternoon_tea: '下午茶',
  dinner: '晚餐',
  late_night: '宵夜',
}

function getTodayStr() {
  const now = new Date()
  const bj = new Date(now.getTime() + 8 * 3600000)
  const y = bj.getUTCFullYear()
  const m = String(bj.getUTCMonth() + 1).padStart(2, '0')
  const d = String(bj.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function fmtMonthDay(str) {
  const [y, m, d] = str.split('-').map(Number)
  return `${m}月${d}日`
}

function truncate(str, max) {
  if (!str) return ''
  if (str.length <= max) return str
  return str.slice(0, max - 1) + '…'
}

exports.main = async () => {
  const today = getTodayStr()
  console.log('=== sendDailyReminder start, date:', today, '===')

  // 1. 查询今日所有开启了提醒的计划
  const planRes = await db.collection('plans')
    .where({ date: today, reminderEnabled: true })
    .get()
  const plans = planRes.data || []
  console.log('reminder plans count:', plans.length)
  if (plans.length === 0) return { msg: 'no reminder plans today' }

  // 2. 批量加载菜品
  const dishIds = [...new Set(plans.map(p => p.dishId))]
  const dishMap = {}
  for (let i = 0; i < dishIds.length; i += 100) {
    const batch = dishIds.slice(i, i + 100)
    const res = await db.collection('dishes').where({ _id: _.in(batch) }).get()
    for (const d of res.data) { dishMap[d._id] = d }
  }

  // 3. 批量加载小组（去重 groupId）
  const groupIds = [...new Set(plans.map(p => p.groupId))]
  const groupMap = {}
  for (const gid of groupIds) {
    try {
      const res = await db.collection('groups').doc(gid).get()
      if (res.data) groupMap[gid] = res.data
    } catch (e) { /* 小组可能已删除 */ }
  }

  // 4. 逐条计划推送（每条推给小组所有成员）
  let sent = 0
  let skipped = 0
  for (const plan of plans) {
    const dish = dishMap[plan.dishId]
    const group = groupMap[plan.groupId]
    if (!dish || !group) continue

    const memberIds = group.memberIds || []
    const mealLabel = MEAL_MAP[plan.mealType] || plan.mealType || ''

    // 搭档昵称
    const partnerIds = plan.partnerIds || []
    let partnerStr = ''
    if (partnerIds.length > 0) {
      const members = group.members || []
      const names = partnerIds.map(pid => {
        const m = members.find(mb => mb.openid === pid)
        return m ? (m.nickName || '') : ''
      })
      partnerStr = names.join('、')
    } else {
      partnerStr = '1人'
    }

    const msgData = {
      thing3: { value: truncate(dish.name, 20) },
      thing16: { value: truncate(mealLabel, 20) },
      thing18: { value: truncate(dish.address || '', 20) },
      thing10: { value: truncate(fmtMonthDay(today) + ' ' + partnerStr, 20) },
      thing4: { value: truncate(dish.note || '', 20) },
    }

    // 推送给小组每个成员
    for (const openid of memberIds) {
      try {
        await cloud.openapi.subscribeMessage.send({
          touser: openid,
          templateId: TMPL_ID,
          data: msgData,
          page: 'pages/calendar/calendar',
        })
        sent++
        console.log('sent to', openid, 'dish:', dish.name)
      } catch (e) {
        if (e.errCode === 43101 || e.errCode === -604101) {
          skipped++
        } else {
          console.error('send fail', openid, e.errCode, e.errMsg)
        }
      }
    }

    // 推送完成后重置 reminderEnabled
    try {
      await db.collection('plans').doc(plan._id).update({
        data: { reminderEnabled: false },
      })
    } catch (e) { /* 不影响主流程 */ }
  }

  console.log('=== done, sent:', sent, 'skipped:', skipped, '===')
  return { msg: 'ok', sent, skipped }
}
