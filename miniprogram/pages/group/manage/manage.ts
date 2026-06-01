import { genCode, dedupeDefaultGroups, createDefaultGroup } from '../../../utils/group'

const app = getApp<IAppOption>()
const db = wx.cloud.database()
const _ = db.command

Component({
  data: {
    groupSections: [] as { title: string; groups: any[] }[],
    currentGroupId: '',
    openid: '',
    showCreate: false,
    showJoin: false,
    groupName: '',
    inviteCode: '',
    creating: false,
    joining: false,
    showEdit: false,
    editGroupName: '',
    editGroupId: '',
    editing: false,
    loading: false,
    showMembers: false,
    membersLoading: false,
    membersGroupName: '',
    membersList: [] as { openid: string; nickName: string; avatarUrl: string; isCreator: boolean }[],
  },
  lifetimes: {
    attached() {
      this.loadGroups()
    },
  },
  methods: {
    async loadGroups() {
      this.setData({ groupSections: [], loading: true })
      if (!app.globalData.openid) {
        await app.globalData.loginPromise
      }
      this.setData({ openid: app.globalData.openid })
      try {
        if (!wx.getStorageSync('_defaultGroupsDeduped')) {
          await dedupeDefaultGroups()
          wx.setStorageSync('_defaultGroupsDeduped', true)
        }

        const all = await db.collection('groups')
          .where({ memberIds: app.globalData.openid })
          .get()
        let currentGroupId = wx.getStorageSync('currentGroupId') || ''

        const hasDefault = all.data.some((g: any) => g.type === 'default')
        if (all.data.length === 0 || !hasDefault) {
          currentGroupId = await createDefaultGroup()
          const all2 = await db.collection('groups')
            .where({ memberIds: app.globalData.openid })
            .get()
          this.setData({ groupSections: this.buildSections(all2.data), currentGroupId })
        } else {
          if (!currentGroupId) {
            const def = all.data.find((g: any) => g.type === 'default')
            if (def) {
              currentGroupId = def._id
              wx.setStorageSync('currentGroupId', currentGroupId)
            }
          }
          this.setData({ groupSections: this.buildSections(all.data), currentGroupId })
        }
      } catch (e) {
        console.error('加载小组失败', e)
      } finally {
        this.setData({ loading: false })
      }
    },

    buildSections(groups: any[]) {
      const openid = app.globalData.openid
      const map = new Map<string, { title: string; groups: any[] }>()

      for (const g of groups) {
        const createdBy = g.createdBy || openid
        const createdByName = g.createdByName || ''

        if (!map.has(createdBy)) {
          const title = createdBy === openid ? '我的小组' : `${createdByName}的小组`
          map.set(createdBy, { title, groups: [] })
        }
        map.get(createdBy)!.groups.push(g)
      }

      const own = map.get(openid)
      const others = [...map.entries()]
        .filter(([key]) => key !== openid)
        .map(([, section]) => section)
      return own ? [own, ...others] : others
    },

    onGroupNameChange(e: any) { this.setData({ groupName: e.detail.value }) },
    openCreate() { this.setData({ showCreate: true, groupName: '' }) },
    closeCreate() { this.setData({ showCreate: false }) },

    async doCreateGroup() {
      const name = this.data.groupName.trim()
      if (!name) {
        wx.showToast({ title: '请输入小组名称', icon: 'none' })
        return
      }
      if (this.data.creating) return
      this.setData({ creating: true })
      try {
        const result = await db.collection('groups').add({
          data: {
            name,
            inviteCode: genCode(),
            createdBy: app.globalData.openid,
            createdByName: app.globalData.userInfo?.nickName || '',
            memberIds: [app.globalData.openid],
            members: [{ openid: app.globalData.openid, nickName: app.globalData.userInfo?.nickName || '', avatarUrl: app.globalData.userInfo?.avatarUrl || '' }],
            createdAt: db.serverDate(),
          },
        })
        wx.showToast({ title: '创建成功', icon: 'success' })
        this.setData({ showCreate: false })
        this.loadGroups()
      } catch (e) {
        wx.showToast({ title: '创建失败', icon: 'none' })
      } finally {
        this.setData({ creating: false })
      }
    },

    onInviteCodeChange(e: any) { this.setData({ inviteCode: e.detail.value.toUpperCase() }) },
    openJoin() { this.setData({ showJoin: true, inviteCode: '' }) },
    closeJoin() { this.setData({ showJoin: false }) },

    async doJoinGroup() {
      const code = this.data.inviteCode.trim()
      if (!code || code.length !== 4) {
        wx.showToast({ title: '请输入4位邀请码', icon: 'none' })
        return
      }
      if (this.data.joining) return
      this.setData({ joining: true })
      try {
        const result = await wx.cloud.callFunction({
          name: 'groupOp',
          data: {
            action: 'join',
            inviteCode: code,
            nickName: app.globalData.userInfo?.nickName || '',
            avatarUrl: app.globalData.userInfo?.avatarUrl || '',
          },
        })
        const r = result.result as any
        if (r.ok) {
          wx.showToast({ title: '已加入', icon: 'success' })
          this.setData({ showJoin: false })
          this.loadGroups()
        } else {
          wx.showToast({ title: r.err || '加入失败', icon: 'none' })
        }
      } catch (e) {
        wx.showToast({ title: '加入失败', icon: 'none' })
      } finally {
        this.setData({ joining: false })
      }
    },

    onToggleGroup(e: any) {
      const groupId = e.currentTarget.dataset.id
      wx.setStorageSync('currentGroupId', groupId)
      wx.setStorageSync('needsRefresh', true)
      const g = this.data.groupSections.flatMap((s: any) => s.groups).find((g: any) => g._id === groupId)
      this.setData({ currentGroupId: groupId })
      wx.showToast({ title: `已切换到${g.name}`, icon: 'success' })
    },

    copyInviteCode(e: any) {
      const code = e.currentTarget.dataset.code
      wx.setClipboardData({ data: code })
    },

    openEditGroup(e: any) {
      const groupId = e.currentTarget.dataset.id
      const groupName = e.currentTarget.dataset.name
      let group: any = null
      for (const section of this.data.groupSections) {
        group = section.groups.find((g: any) => g._id === groupId)
        if (group) break
      }
      if (!group) return
      this.setData({ showEdit: true, editGroupId: groupId, editGroupName: group.name })
    },
    onEditNameChange(e: any) { this.setData({ editGroupName: e.detail.value }) },
    closeEdit() { this.setData({ showEdit: false }) },
    async doEditGroup() {
      const name = this.data.editGroupName.trim()
      if (!name) {
        wx.showToast({ title: '请输入小组名称', icon: 'none' })
        return
      }
      if (this.data.editing) return
      this.setData({ editing: true })
      try {
        await db.collection('groups').doc(this.data.editGroupId).update({ data: { name } })
        wx.showToast({ title: '已更新', icon: 'success' })
        this.setData({ showEdit: false })
        this.loadGroups()
      } catch (e) {
        wx.showToast({ title: '更新失败', icon: 'none' })
      } finally {
        this.setData({ editing: false })
      }
    },

    leaveGroup(e: any) {
      const groupId = e.currentTarget.dataset.id
      const groupName = e.currentTarget.dataset.name
      wx.showModal({
        title: '退出小组',
        content: '确定退出「」吗？',
        confirmColor: '#e74c3c',
        success: async (res) => {
          if (!res.confirm) return
          try {
            const result = await wx.cloud.callFunction({
              name: 'groupOp',
              data: { action: 'leave', groupId },
            })
            const r = result.result as any
            if (r.ok) {
              wx.showToast({ title: '已退出', icon: 'success' })
              this.loadGroups()
            } else {
              wx.showToast({ title: r.err || '退出失败', icon: 'none' })
            }
          } catch (e) {
            wx.showToast({ title: '退出失败', icon: 'none' })
          }
        },
      })
    },

    deleteGroup(e: any) {
      const groupId = e.currentTarget.dataset.id
      let group: any = null
      for (const section of this.data.groupSections) {
        group = section.groups.find((g: any) => g._id === groupId)
        if (group) break
      }
      if (!group) return
      if (group.type === 'default') {
        wx.showToast({ title: '默认分组无法删除', icon: 'none' })
        return
      }
      if (this.data.currentGroupId === groupId) {
        wx.showToast({ title: '请先启用其他分组后再删除', icon: 'none' })
        return
      }
      wx.showModal({
        title: '确认删除',
        content: '删除后该小组的分类和菜品也将一并清除，所有成员将同步移除该小组',
        confirmColor: '#e74c3c',
        success: async (res) => {
          if (!res.confirm) return
          wx.showLoading({ title: '删除中..', mask: true })
          try {
            const result = await wx.cloud.callFunction({
              name: 'groupOp',
              data: { action: 'delete', groupId },
            })
            const r = result.result as any
            wx.hideLoading()
            if (r.ok) {
              wx.showToast({ title: '已删除', icon: 'success' })
              this.loadGroups()
            } else {
              wx.showToast({ title: r.err || '删除失败', icon: 'none' })
            }
          } catch (e) {
            wx.hideLoading()
            wx.showToast({ title: '删除失败', icon: 'none' })
          }
        },
      })
    },

    async openMembers(e: any) {
      const groupId = e.currentTarget.dataset.id
      const groupName = e.currentTarget.dataset.name
      let group: any = null
      for (const section of this.data.groupSections) {
        group = section.groups.find((g: any) => g._id === groupId)
        if (group) break
      }
      if (!group) return

      this.setData({ showMembers: true, membersLoading: true, membersGroupName: groupName || group.name, membersList: [] })

      const memberIds: string[] = group.memberIds || []
      const fallbackMap: Record<string, { nickName: string; avatarUrl: string }> = {}
      for (const m of (group.members || [])) {
        fallbackMap[m.openid] = { nickName: m.nickName, avatarUrl: m.avatarUrl }
      }
      try {
        const res = await wx.cloud.callFunction({ name: 'getMemberInfos', data: { openids: memberIds } })
        const infos = (res.result as any)?.list || []
        for (const info of infos) {
          fallbackMap[info.openid] = { nickName: info.nickName || fallbackMap[info.openid]?.nickName || '', avatarUrl: info.avatarUrl || fallbackMap[info.openid]?.avatarUrl || '' }
        }
      } catch (e) { /* 失败则使用缓存数据 */ }
      const membersList = memberIds
        .map(id => ({
          openid: id,
          nickName: fallbackMap[id]?.nickName || '',
          avatarUrl: fallbackMap[id]?.avatarUrl || '',
          isCreator: id === group.createdBy,
        }))
        .filter(m => m.openid)
      this.setData({ membersList, membersLoading: false })
    },

    closeMembers() {
      this.setData({ showMembers: false, membersList: [], membersGroupName: '', membersLoading: false })
    },

    async resetDefaultGroup(e: any) {
      const groupId = e.currentTarget.dataset.id
      wx.showModal({
        title: '重置默认分组',
        content: '将恢复默认名称和全部分类数据，该分组下的菜品也将一并清除，确定继续？',
        confirmColor: '#FF6B35',
        success: async (res) => {
          if (!res.confirm) return
          try {
            await db.collection('groups').doc(groupId).update({
              data: { name: '默认分组' },
            })
            // 批量删除分类和菜品
            await db.collection('categories').where({ groupId }).remove()
            await db.collection('dishes').where({ groupId }).remove()
            wx.showToast({ title: '已重置', icon: 'success' })
            wx.setStorageSync('needsRefresh', true)
            this.loadGroups()
          } catch (e) {
            wx.showToast({ title: '重置失败', icon: 'none' })
          }
        },
      })
    },
  },
})
