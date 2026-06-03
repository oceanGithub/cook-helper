Component({
  data: {
    recipeId: '',
    recipe: {} as any,
    statusBarHeight: 20,
    openid: '',
    isLiked: false,
    isBookmarked: false,
    isTried: false,
    isCreator: false,
    comments: [] as any[],
    tries: [] as any[],
    showComment: false,
    commentText: '',
    createTimeText: '',
    deleting: false,
    commenting: false,
    loading: true,
    deletingCommentId: '',
    deletingTryId: '',
    commentsLoading: true,
    triesLoading: true,
  },

  lifetimes: {
    attached() {
      const recipeId = wx.getStorageSync('detailRecipeId') || ''
      wx.removeStorageSync('detailRecipeId')
      const systemInfo = wx.getSystemInfoSync()

      this.setData({
        recipeId,
        statusBarHeight: systemInfo.statusBarHeight || 20
      })

      if (!recipeId) {
        wx.showToast({ title: '参数错误', icon: 'none' })
        setTimeout(() => wx.navigateBack(), 800)
        return
      }

      this.loadRecipe()
    },
  },

  pageLifetimes: {
    show() {
      if (wx.getStorageSync('needsRefresh')) {
        wx.removeStorageSync('needsRefresh')
        this.loadRecipe()
        this.loadComments()
        this.loadTries()
        this.checkStatus()
      }
    },
  },

  methods: {
    // 刷新云存储临时链接
    async refreshTempURLs(recipe: any) {
      // 收集所有 cloud:// 开头的文件ID
      const fileIDs: string[] = []

      if (recipe.coverImage && recipe.coverImage.startsWith('cloud://')) {
        fileIDs.push(recipe.coverImage)
      }

      if (recipe.steps) {
        recipe.steps.forEach((step: any) => {
          if (step.image && step.image.startsWith('cloud://')) {
            fileIDs.push(step.image)
          }
        })
      }

      if (fileIDs.length === 0) return

      try {
        const res = await wx.cloud.getTempFileURL({ fileList: fileIDs })
        const urlMap: Record<string, string> = {}
        res.fileList.forEach((item: any) => {
          if (item.status === 0) {
            urlMap[item.fileID] = item.tempFileURL
          }
        })

        // 替换为新的临时链接
        if (recipe.coverImage && urlMap[recipe.coverImage]) {
          recipe.coverImage = urlMap[recipe.coverImage]
        }

        if (recipe.steps) {
          recipe.steps.forEach((step: any) => {
            if (step.image && urlMap[step.image]) {
              step.image = urlMap[step.image]
            }
          })
        }
      } catch (e) {
        console.error('刷新临时链接失败', e)
      }
    },

    // 刷新用户头像
    async refreshAvatars(list: any[]) {
      // 收集所有需要刷新头像的 openid
      const openids = new Set<string>()
      list.forEach((item: any) => {
        if (item._openid) openids.add(item._openid)
      })

      if (openids.size === 0) return

      try {
        const res = await wx.cloud.callFunction({
          name: 'getMemberInfos',
          data: { openids: [...openids] }
        })

        const infos = (res.result as any)?.list || []
        const avatarMap: Record<string, string> = {}
        const nameMap: Record<string, string> = {}

        for (const info of infos) {
          if (info.avatarUrl) avatarMap[info.openid] = info.avatarUrl
          if (info.nickName && info.nickName !== '匿名') nameMap[info.openid] = info.nickName
        }

        // 更新列表中的头像和昵称
        list.forEach((item: any) => {
          if (item._openid) {
            if (avatarMap[item._openid]) {
              item.createdByAvatar = avatarMap[item._openid]
            }
            if (nameMap[item._openid] && (!item.createdByName || item.createdByName === '匿名')) {
              item.createdByName = nameMap[item._openid]
            }
          }
        })
      } catch (e) {
        console.error('刷新用户头像失败', e)
      }
    },

    async loadRecipe() {
      try {
        const db = wx.cloud.database()
        const res = await db.collection('recipes').doc(this.data.recipeId).get()
        const recipe = res.data as any

        if (!recipe) {
          wx.showToast({ title: '菜谱不存在', icon: 'none' })
          setTimeout(() => wx.navigateBack(), 800)
          return
        }

        const app = getApp<IAppOption>()
        const openid = app.globalData.openid
        const isCreator = recipe.createdBy === openid

        // 格式化创建时间
        const createTime = new Date(recipe.createdAt)
        const createTimeText = `${createTime.getFullYear()}-${String(createTime.getMonth() + 1).padStart(2, '0')}-${String(createTime.getDate()).padStart(2, '0')}`

        // 刷新云存储临时链接
        await this.refreshTempURLs(recipe)

        this.setData({
          recipe,
          openid,
          isCreator,
          createTimeText,
          loading: false
        })

        // 加载完菜谱后再加载其他数据
        this.loadComments()
        this.loadTries()
        this.checkStatus()

      } catch (e: any) {
        console.error('加载菜谱失败', e)
        console.error('recipeId:', this.data.recipeId)
        console.error('errCode:', e?.errCode)
        console.error('errMsg:', e?.errMsg)
        const msg = e?.errCode === -1 ? '数据库未初始化' : '加载失败'
        wx.showToast({ title: msg, icon: 'none' })
        this.setData({ loading: false })
      }
    },

    async loadComments() {
      try {
        this.setData({ commentsLoading: true })
        const db = wx.cloud.database()
        const res = await db.collection('recipeComments')
          .where({ recipeId: this.data.recipeId })
          .orderBy('createdAt', 'desc')
          .get()

        const comments = (res.data || []).map((comment: any) => {
          const createTime = new Date(comment.createdAt)
          comment.createTimeText = `${createTime.getMonth() + 1}-${createTime.getDate()} ${String(createTime.getHours()).padStart(2, '0')}:${String(createTime.getMinutes()).padStart(2, '0')}`
          return comment
        })

        // 刷新用户头像
        await this.refreshAvatars(comments)

        this.setData({ comments, commentsLoading: false })
      } catch (e) {
        console.error('加载评论失败', e)
        this.setData({ commentsLoading: false })
      }
    },

    async loadTries() {
      try {
        this.setData({ triesLoading: true })
        const db = wx.cloud.database()
        const res = await db.collection('recipeTries')
          .where({ recipeId: this.data.recipeId })
          .orderBy('createdAt', 'desc')
          .limit(10)
          .get()

        const tries = res.data || []

        // 刷新打卡图片的临时链接
        const fileIDs: string[] = []
        tries.forEach((t: any) => {
          if (t.images) {
            t.images.forEach((img: string) => {
              if (img.startsWith('cloud://')) fileIDs.push(img)
            })
          }
        })

        if (fileIDs.length > 0) {
          try {
            const urlRes = await wx.cloud.getTempFileURL({ fileList: fileIDs })
            const urlMap: Record<string, string> = {}
            urlRes.fileList.forEach((item: any) => {
              if (item.status === 0) urlMap[item.fileID] = item.tempFileURL
            })
            tries.forEach((t: any) => {
              if (t.images) {
                t.images = t.images.map((img: string) => urlMap[img] || img)
              }
            })
          } catch (e) {
            console.error('刷新打卡图片链接失败', e)
          }
        }

        // 刷新用户头像
        await this.refreshAvatars(tries)

        this.setData({ tries, triesLoading: false })
      } catch (e) {
        console.error('加载打卡记录失败', e)
        this.setData({ triesLoading: false })
      }
    },

    async checkStatus() {
      try {
        const res = await wx.cloud.callFunction({
          name: 'recipeOp',
          data: {
            action: 'checkStatus',
            id: this.data.recipeId,
          },
        })
        
        const result = res.result as any
        if (result) {
          this.setData({
            isLiked: result.liked || false,
            isBookmarked: result.bookmarked || false,
            isTried: result.tried || false,
          })
        }
      } catch (e) {
        console.error('检查状态失败', e)
      }
    },

    previewCover() {
      const cover = this.data.recipe.coverImage
      if (cover) {
        wx.previewImage({ current: cover, urls: [cover] })
      }
    },

    previewStepImage(e: WechatMiniprogram.TouchEvent) {
      const index = e.currentTarget.dataset.index
      const step = this.data.recipe.steps[index]
      if (step?.image) {
        wx.previewImage({
          current: step.image,
          urls: [step.image],
        })
      }
    },

    previewTryImage(e: WechatMiniprogram.TouchEvent) {
      const tryIndex = e.currentTarget.dataset.tryIndex
      const imgIndex = e.currentTarget.dataset.imgIndex
      const tryItem = this.data.tries[tryIndex]
      if (tryItem?.images) {
        wx.previewImage({
          current: tryItem.images[imgIndex],
          urls: tryItem.images,
        })
      }
    },

    startCooking() {
      wx.setStorageSync('detailRecipeId', this.data.recipeId)
      wx.navigateTo({ url: '/pages/kitchen/cook/cook' })
    },

    goToTry() {
      wx.setStorageSync('detailRecipeId', this.data.recipeId)
      wx.navigateTo({ url: '/pages/kitchen/try/try' })
    },

    async toggleLike() {
      try {
        const action = this.data.isLiked ? 'unlike' : 'like'
        await wx.cloud.callFunction({
          name: 'recipeOp',
          data: {
            action,
            id: this.data.recipeId,
          },
        })
        
        this.setData({
          isLiked: !this.data.isLiked,
          'recipe.likeCount': (this.data.recipe.likeCount || 0) + (this.data.isLiked ? -1 : 1),
        })
      } catch (e) {
        console.error('点赞失败', e)
        wx.showToast({ title: '操作失败', icon: 'none' })
      }
    },

    async toggleBookmark() {
      try {
        const action = this.data.isBookmarked ? 'unbookmark' : 'bookmark'
        await wx.cloud.callFunction({
          name: 'recipeOp',
          data: {
            action,
            id: this.data.recipeId,
          },
        })
        
        this.setData({
          isBookmarked: !this.data.isBookmarked,
        })
        
        wx.showToast({ 
          title: this.data.isBookmarked ? '已收藏' : '已取消收藏', 
          icon: 'success' 
        })
      } catch (e) {
        console.error('收藏失败', e)
        wx.showToast({ title: '操作失败', icon: 'none' })
      }
    },

    showCommentInput() {
      this.setData({ showComment: true })
    },

    hideCommentInput() {
      this.setData({ showComment: false, commentText: '' })
    },

    onCommentInput(e: WechatMiniprogram.Input) {
      this.setData({ commentText: e.detail.value })
    },

    async submitComment() {
      if (!this.data.commentText.trim()) {
        wx.showToast({ title: '请输入评论内容', icon: 'none' })
        return
      }

      if (this.data.commenting) return
      this.setData({ commenting: true })

      try {
        const app = getApp<IAppOption>()
        await wx.cloud.callFunction({
          name: 'recipeOp',
          data: {
            action: 'comment',
            id: this.data.recipeId,
            data: {
              content: this.data.commentText,
              createdByName: app.globalData.userInfo?.nickName || '',
              createdByAvatar: app.globalData.userInfo?.avatarUrl || '',
            },
          },
        })

        wx.showToast({ title: '评论成功', icon: 'success' })
        this.hideCommentInput()
        this.loadComments()
      } catch (e) {
        console.error('评论失败', e)
        wx.showToast({ title: '评论失败', icon: 'none' })
      } finally {
        this.setData({ commenting: false })
      }
    },

    // 删除评论
    confirmDeleteComment(e: WechatMiniprogram.TouchEvent) {
      const commentId = e.currentTarget.dataset.id
      wx.showModal({
        title: '删除评论',
        content: '确定要删除这条评论吗？',
        confirmColor: '#ff4d4f',
        success: (res) => {
          if (res.confirm) {
            this.deleteComment(commentId)
          }
        },
      })
    },

    async deleteComment(commentId: string) {
      if (this.data.deletingCommentId) return
      this.setData({ deletingCommentId: commentId })
      try {
        await wx.cloud.callFunction({
          name: 'recipeOp',
          data: {
            action: 'deleteComment',
            data: { commentId },
          },
        })
        wx.showToast({ title: '已删除', icon: 'success' })
        this.loadComments()
      } catch (e) {
        console.error('删除评论失败', e)
        wx.showToast({ title: '删除失败', icon: 'none' })
      } finally {
        this.setData({ deletingCommentId: '' })
      }
    },

    // 删除打卡记录
    confirmDeleteTry(e: WechatMiniprogram.TouchEvent) {
      const tryId = e.currentTarget.dataset.id
      wx.showModal({
        title: '删除打卡',
        content: '确定要删除这条打卡记录吗？',
        confirmColor: '#ff4d4f',
        success: (res) => {
          if (res.confirm) {
            this.deleteTry(tryId)
          }
        },
      })
    },

    async deleteTry(tryId: string) {
      if (this.data.deletingTryId) return
      this.setData({ deletingTryId: tryId })
      try {
        await wx.cloud.callFunction({
          name: 'recipeOp',
          data: {
            action: 'deleteTry',
            data: { tryId },
          },
        })
        wx.showToast({ title: '已删除', icon: 'success' })
        this.loadTries()
      } catch (e) {
        console.error('删除打卡失败', e)
        wx.showToast({ title: '删除失败', icon: 'none' })
      } finally {
        this.setData({ deletingTryId: '' })
      }
    },

    // 头像加载失败处理
    onAvatarError(e: WechatMiniprogram.ImageErrorEvent) {
      const type = e.currentTarget.dataset.type // 'author' | 'try' | 'comment'
      const index = e.currentTarget.dataset.index

      if (type === 'author') {
        this.setData({ 'recipe.createdByAvatar': '' })
      } else if (type === 'try' && index !== undefined) {
        this.setData({ [`tries[${index}].createdByAvatar`]: '' })
      } else if (type === 'comment' && index !== undefined) {
        this.setData({ [`comments[${index}].createdByAvatar`]: '' })
      }
    },

    goToEdit() {
      wx.setStorageSync('editRecipeId', this.data.recipeId)
      wx.navigateTo({ url: '/pages/kitchen/publish/publish' })
    },

    confirmDelete() {
      wx.showModal({
        title: '确认删除',
        content: '删除后无法恢复，确定要删除这个菜谱吗？',
        confirmColor: '#ff4d4f',
        success: (res) => {
          if (res.confirm) {
            this.deleteRecipe()
          }
        },
      })
    },

    async deleteRecipe() {
      if (this.data.deleting) return
      this.setData({ deleting: true })
      try {
        await wx.cloud.callFunction({
          name: 'recipeOp',
          data: {
            action: 'remove',
            id: this.data.recipeId,
          },
        })

        wx.showToast({ title: '已删除', icon: 'success' })
        wx.setStorageSync('needsRefresh', true)
        setTimeout(() => wx.navigateBack(), 800)
      } catch (e) {
        console.error('删除失败', e)
        wx.showToast({ title: '删除失败', icon: 'none' })
      } finally {
        this.setData({ deleting: false })
      }
    },
  },
})
