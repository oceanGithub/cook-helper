import { INGREDIENT_PRESETS, SEASONING_PRESETS } from '../../../utils/presets'

const app = getApp<IAppOption>()
const db = wx.cloud.database()

interface Step {
  text: string
  image?: string
  timer?: number
}

interface Ingredient {
  name: string
  amount: string
}

Component({
  data: {
    statusBarHeight: 20,
    currentStep: 1,
    
    // Step 1: 选择菜品
    showDishModal: false,
    dishTab: 'manual',
    dishes: [] as any[],
    filteredDishes: [] as any[],
    dishSearchKey: '',
    selectedDishId: '',
    selectedDishName: '',
    manualDishName: '',
    
    // Step 2: 食材
    ingredients: [] as Ingredient[],
    showIngredientModal: false,
    ingredientTab: 'preset',
    ingredientSearchKey: '',
    searchResults: [] as string[],
    ingredientCategories: [] as string[],
    currentCategory: '',
    currentPresets: [] as string[],
    customIngredientName: '',
    customIngredientAmount: '',

    // Step 3: 调料
    seasonings: [] as Ingredient[],
    showSeasoningModal: false,
    seasoningTab: 'preset',
    seasoningSearchKey: '',
    seasoningSearchResults: [] as string[],
    seasoningCategories: [] as string[],
    currentSeasoningCategory: '',
    currentSeasoningPresets: [] as string[],
    customSeasoningName: '',
    customSeasoningAmount: '',
    
    // Step 4: 步骤
    steps: [{ text: '', image: '', imageUrl: '', timer: 0 }] as Step[],
    showTimerModal: false,
    currentStepIndex: 0,
    timerPickerValue: [0],
    timerMinutes: [0, 1, 2, 3, 5, 10, 15, 20, 30, 45, 60, 90, 120],
    
    // Step 5: 基本信息
    difficulty: 1,
    prepTime: '',
    cookTime: '',
    servings: '',
    tips: '',
    
    // Step 6: 提交状态
    submitting: false,
    dishName: '',

    // 菜品封面
    coverImage: '',
    coverImageUrl: '',

    // 编辑模式
    editMode: false,
    editRecipeId: '',

    // 布局高度
    contentPaddingTop: 0,
    contentPaddingBottom: 0,
  },

  lifetimes: {
    attached() {
      const systemInfo = wx.getSystemInfoSync()
      const ingredientCategories = Object.keys(INGREDIENT_PRESETS)
      const seasoningCategories = Object.keys(SEASONING_PRESETS)
      const editRecipeId = wx.getStorageSync('editRecipeId') || ''
      wx.removeStorageSync('editRecipeId')

      this.setData({
        statusBarHeight: systemInfo.statusBarHeight || 20,
        ingredientCategories,
        seasoningCategories,
        currentCategory: ingredientCategories[0] || '',
        currentSeasoningCategory: seasoningCategories[0] || '',
        currentPresets: INGREDIENT_PRESETS[ingredientCategories[0]] || [],
        currentSeasoningPresets: SEASONING_PRESETS[seasoningCategories[0]] || [],
        editMode: !!editRecipeId,
        editRecipeId,
      })

      this.loadDishes()

      // 编辑模式：加载已有菜谱数据
      if (editRecipeId) {
        wx.setNavigationBarTitle({ title: '编辑菜谱' })
        this.loadRecipeForEdit(editRecipeId)
      }

      // 延迟测量顶部和底部高度，计算中间区域的 padding
      setTimeout(() => {
        const query = this.createSelectorQuery()
        query.select('.progress-section').boundingClientRect()
        query.select('.bottom-actions').boundingClientRect()
        query.exec((res: any[]) => {
          if (res[0] && res[1]) {
            this.setData({
              contentPaddingTop: res[0].height + 10,
              contentPaddingBottom: res[1].height + 10,
            })
          }
        })
      }, 100)
    },
  },

  methods: {
    // 加载菜品列表
    async loadDishes() {
      try {
        const res = await db.collection('dishes').get()
        const dishes = res.data || []
        // 刷新云存储图片URL
        await this.refreshDishImages(dishes)
        this.setData({
          dishes,
          filteredDishes: dishes,
        })
      } catch (e) {
        console.error('加载菜品失败', e)
      }
    },

    // 刷新菜品图片URL（云存储fileID转临时URL，保留原始cloud ID）
    async refreshDishImages(dishes: any[]) {
      const fileIDs: string[] = []
      for (const dish of dishes) {
        if (dish.images && dish.images.length > 0) {
          fileIDs.push(...dish.images.filter((url: string) => url && url.startsWith('cloud://')))
        }
        if (dish.imageUrl && dish.imageUrl.startsWith('cloud://')) {
          fileIDs.push(dish.imageUrl)
        }
      }
      if (fileIDs.length === 0) return
      try {
        const urlMap = await this.refreshImageURLs(fileIDs)
        for (const dish of dishes) {
          if (dish.images && dish.images.length > 0) {
            dish.displayImages = dish.images.map((url: string) => {
              if (!url) return ''
              if (url.startsWith('cloud://')) return urlMap[url] || ''
              return url
            }).filter(Boolean)
          }
          if (dish.imageUrl) {
            if (dish.imageUrl.startsWith('cloud://')) {
              dish.displayImageUrl = urlMap[dish.imageUrl] || ''
            } else {
              dish.displayImageUrl = dish.imageUrl
            }
          }
        }
      } catch (e) {
        console.error('刷新菜品图片失败', e)
      }
    },

    // 通用 cloud:// → https:// 转换（通过云函数获取管理权限）
    async refreshImageURLs(urls: string[]): Promise<Record<string, string>> {
      const fileIDs = urls.filter(u => u && u.startsWith('cloud://'))
      if (fileIDs.length === 0) return {}
      const res = await wx.cloud.callFunction({
        name: 'dishOp',
        data: { action: 'getTempFileURL', fileIDs: [...new Set(fileIDs)] }
      })
      const map: Record<string, string> = {}
      const result = res.result as any
      ;(result?.fileList || []).forEach((f: any) => {
        if (f.tempFileURL && f.fileID) map[f.fileID] = f.tempFileURL
      })
      return map
    },

    // 编辑模式：加载已有菜谱数据
    async loadRecipeForEdit(recipeId: string) {
      try {
        const res = await db.collection('recipes').doc(recipeId).get()
        const recipe = res.data as any
        if (!recipe) return

        // 收集所有需要转换的 cloud:// URL
        const urls: string[] = []
        if (recipe.coverImage) urls.push(recipe.coverImage)
        if (recipe.steps) {
          recipe.steps.forEach((s: any) => { if (s.image) urls.push(s.image) })
        }
        const urlMap = await this.refreshImageURLs(urls)

        const steps = (recipe.steps || []).map((s: any) => ({
          text: s.text || '',
          image: s.image || '',
          imageUrl: s.image ? (urlMap[s.image] || '') : '',
          timer: s.timer || 0,
        }))

        this.setData({
          selectedDishId: recipe.dishId || '',
          selectedDishName: recipe.dishName || '',
          dishName: recipe.dishName || '',
          coverImage: recipe.coverImage || '',
          coverImageUrl: recipe.coverImage ? (urlMap[recipe.coverImage] || '') : '',
          ingredients: recipe.ingredients || [],
          seasonings: recipe.seasonings || [],
          steps: steps.length > 0 ? steps : [{ text: '', image: '', imageUrl: '', timer: 0 }],
          difficulty: recipe.difficulty || 1,
          prepTime: recipe.prepTime ? String(recipe.prepTime) : '',
          cookTime: recipe.cookTime ? String(recipe.cookTime) : '',
          servings: recipe.servings ? String(recipe.servings) : '',
          tips: recipe.tips || '',
        })
      } catch (e) {
        console.error('加载菜谱失败', e)
        wx.showToast({ title: '加载菜谱失败', icon: 'none' })
      }
    },

    // Step 1: 弹窗控制
    showDishPicker() {
      this.setData({
        showDishModal: true,
        dishTab: this.data.selectedDishId ? 'existing' : 'manual',
        dishSearchKey: '',
        filteredDishes: this.data.dishes,
      })
    },

    hideDishPicker() {
      this.setData({ showDishModal: false })
    },

    // Step 1: 切换菜品选择模式
    switchDishTab(e: WechatMiniprogram.TouchEvent) {
      this.setData({ dishTab: e.currentTarget.dataset.tab })
    },

    // Step 1: 搜索菜品
    onDishSearch(e: WechatMiniprogram.Input) {
      const key = e.detail.value.toLowerCase()
      const filtered = this.data.dishes.filter((dish: any) =>
        dish.name.toLowerCase().includes(key)
      )
      this.setData({ dishSearchKey: key, filteredDishes: filtered })
    },

    // Step 1: 清除搜索
    clearDishSearch() {
      this.setData({ dishSearchKey: '', filteredDishes: this.data.dishes })
    },

    // Step 1: 选择已有菜品
    async selectDish(e: WechatMiniprogram.TouchEvent) {
      const { id, name, images, imageUrl } = e.currentTarget.dataset
      // 从菜品图片中取第一张作为封面（cloud:// URL）
      let coverImage = ''
      const imagesArr = Array.isArray(images) ? images : (typeof images === 'string' ? images.split(',') : [])
      if (imagesArr.length > 0 && imagesArr[0]) {
        coverImage = imagesArr[0]
      } else if (imageUrl) {
        coverImage = imageUrl
      }
      // 转换为展示 URL
      const urlMap = coverImage ? await this.refreshImageURLs([coverImage]) : {}
      const coverImageUrl = urlMap[coverImage] || ''
      this.setData({
        selectedDishId: id,
        selectedDishName: name,
        manualDishName: '',
        dishName: name,
        coverImage,
        coverImageUrl,
        showDishModal: false,
      })
    },

    // Step 1: 确认手动输入
    confirmManualDish() {
      if (!this.data.manualDishName.trim()) {
        wx.showToast({ title: '请输入菜谱名称', icon: 'none' })
        return
      }
      this.setData({
        selectedDishId: '',
        selectedDishName: '',
        dishName: this.data.manualDishName.trim(),
        coverImage: '',  // 手动输入需要重新上传封面
        coverImageUrl: '',
        showDishModal: false,
      })
    },

    // Step 1: 手动输入菜名
    onManualDishNameInput(e: WechatMiniprogram.Input) {
      this.setData({ manualDishName: e.detail.value })
    },

    // Step 1: 清除已选菜品
    clearSelectedDish() {
      this.setData({
        selectedDishId: '',
        selectedDishName: '',
        manualDishName: '',
        dishName: '',
        coverImage: '',
        coverImageUrl: '',
      })
    },

    // Step 1: 选择封面图
    chooseCoverImage() {
      wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        success: (res) => {
          this.setData({ coverImage: res.tempFiles[0].tempFilePath, coverImageUrl: '' })
        },
      })
    },

    // Step 1: 预览封面图
    previewCoverImage() {
      const url = this.data.coverImageUrl || this.data.coverImage
      if (url) {
        wx.previewImage({ current: url, urls: [url] })
      }
    },

    // Step 1: 删除封面图
    removeCoverImage() {
      this.setData({ coverImage: '', coverImageUrl: '' })
    },

    // Step 2: 弹窗控制
    showIngredientPicker() {
      this.setData({
        showIngredientModal: true,
        ingredientTab: 'preset',
        ingredientSearchKey: '',
        searchResults: [],
        customIngredientName: '',
        customIngredientAmount: '',
        currentCategory: this.data.ingredientCategories[0] || '',
        currentPresets: INGREDIENT_PRESETS[this.data.ingredientCategories[0]] || [],
      })
    },

    hideIngredientPicker() {
      this.setData({ showIngredientModal: false })
    },

    switchIngredientTab(e: WechatMiniprogram.TouchEvent) {
      this.setData({ ingredientTab: e.currentTarget.dataset.tab })
    },

    // Step 2: 搜索食材（跨所有分类）
    onIngredientSearch(e: WechatMiniprogram.Input) {
      const key = e.detail.value.toLowerCase()
      if (!key) {
        this.setData({ ingredientSearchKey: '', searchResults: [] })
        return
      }
      const results: string[] = []
      const categories = Object.keys(INGREDIENT_PRESETS)
      for (let i = 0; i < categories.length; i++) {
        const items = INGREDIENT_PRESETS[categories[i]]
        for (let j = 0; j < items.length; j++) {
          if (items[j].toLowerCase().includes(key) && results.indexOf(items[j]) === -1) {
            results.push(items[j])
          }
        }
      }
      this.setData({ ingredientSearchKey: key, searchResults: results })
    },

    clearIngredientSearch() {
      this.setData({
        ingredientSearchKey: '',
        searchResults: [],
        currentCategory: this.data.ingredientCategories[0] || '',
        currentPresets: INGREDIENT_PRESETS[this.data.ingredientCategories[0]] || [],
      })
    },

    // Step 2: 切换食材分类
    switchIngredientCategory(e: WechatMiniprogram.TouchEvent) {
      const key = e.currentTarget.dataset.key
      this.setData({
        currentCategory: key,
        currentPresets: INGREDIENT_PRESETS[key] || [],
      })
    },

    // Step 2: 点击切换食材（点击添加，再点移除）
    toggleIngredient(e: WechatMiniprogram.TouchEvent) {
      const name = e.currentTarget.dataset.name
      const ingredients = [...this.data.ingredients]
      const index = ingredients.findIndex(i => i.name === name)

      if (index > -1) {
        ingredients.splice(index, 1)
      } else {
        ingredients.push({ name, amount: '适量' })
      }

      this.setData({ ingredients })
    },

    // Step 2: 自定义食材输入
    onCustomIngredientName(e: WechatMiniprogram.Input) {
      this.setData({ customIngredientName: e.detail.value })
    },

    onCustomIngredientAmount(e: WechatMiniprogram.Input) {
      this.setData({ customIngredientAmount: e.detail.value })
    },

    // Step 2: 添加自定义食材
    addCustomIngredient() {
      const { customIngredientName, customIngredientAmount, ingredients } = this.data
      if (!customIngredientName.trim()) {
        wx.showToast({ title: '请输入食材名称', icon: 'none' })
        return
      }

      if (ingredients.find(i => i.name === customIngredientName.trim())) {
        wx.showToast({ title: '该食材已添加', icon: 'none' })
        return
      }

      const newIngredients = [...ingredients, {
        name: customIngredientName.trim(),
        amount: customIngredientAmount.trim() || '适量',
      }]

      this.setData({
        ingredients: newIngredients,
        customIngredientName: '',
        customIngredientAmount: '',
      })
    },

    // Step 2: 删除食材
    removeIngredient(e: WechatMiniprogram.TouchEvent) {
      const index = e.currentTarget.dataset.index
      const ingredients = [...this.data.ingredients]
      ingredients.splice(index, 1)
      this.setData({ ingredients })
    },

    // Step 2: 清空全部食材
    clearAllIngredients() {
      wx.showModal({
        title: '确认清空',
        content: '确定要删除全部已选食材吗？',
        confirmColor: '#ff4d4f',
        success: (res) => {
          if (res.confirm) {
            this.setData({ ingredients: [] })
          }
        },
      })
    },

    // Step 3: 弹窗控制
    showSeasoningPicker() {
      this.setData({
        showSeasoningModal: true,
        seasoningTab: 'preset',
        seasoningSearchKey: '',
        seasoningSearchResults: [],
        customSeasoningName: '',
        customSeasoningAmount: '',
        currentSeasoningCategory: this.data.seasoningCategories[0] || '',
        currentSeasoningPresets: SEASONING_PRESETS[this.data.seasoningCategories[0]] || [],
      })
    },

    hideSeasoningPicker() {
      this.setData({ showSeasoningModal: false })
    },

    switchSeasoningTab(e: WechatMiniprogram.TouchEvent) {
      this.setData({ seasoningTab: e.currentTarget.dataset.tab })
    },

    // Step 3: 搜索调料（跨所有分类）
    onSeasoningSearch(e: WechatMiniprogram.Input) {
      const key = e.detail.value.toLowerCase()
      if (!key) {
        this.setData({ seasoningSearchKey: '', seasoningSearchResults: [] })
        return
      }
      const results: string[] = []
      const categories = Object.keys(SEASONING_PRESETS)
      for (let i = 0; i < categories.length; i++) {
        const items = SEASONING_PRESETS[categories[i]]
        for (let j = 0; j < items.length; j++) {
          if (items[j].toLowerCase().includes(key) && results.indexOf(items[j]) === -1) {
            results.push(items[j])
          }
        }
      }
      this.setData({ seasoningSearchKey: key, seasoningSearchResults: results })
    },

    clearSeasoningSearch() {
      this.setData({
        seasoningSearchKey: '',
        seasoningSearchResults: [],
        currentSeasoningCategory: this.data.seasoningCategories[0] || '',
        currentSeasoningPresets: SEASONING_PRESETS[this.data.seasoningCategories[0]] || [],
      })
    },

    // Step 3: 切换调料分类
    switchSeasoningCategory(e: WechatMiniprogram.TouchEvent) {
      const key = e.currentTarget.dataset.key
      this.setData({
        currentSeasoningCategory: key,
        currentSeasoningPresets: SEASONING_PRESETS[key] || [],
      })
    },

    // Step 3: 点击切换调料
    toggleSeasoning(e: WechatMiniprogram.TouchEvent) {
      const name = e.currentTarget.dataset.name
      const seasonings = [...this.data.seasonings]
      const index = seasonings.findIndex(s => s.name === name)

      if (index > -1) {
        seasonings.splice(index, 1)
      } else {
        seasonings.push({ name, amount: '适量' })
      }

      this.setData({ seasonings })
    },

    onCustomSeasoningName(e: WechatMiniprogram.Input) {
      this.setData({ customSeasoningName: e.detail.value })
    },

    onCustomSeasoningAmount(e: WechatMiniprogram.Input) {
      this.setData({ customSeasoningAmount: e.detail.value })
    },

    addCustomSeasoning() {
      const { customSeasoningName, customSeasoningAmount, seasonings } = this.data
      if (!customSeasoningName.trim()) {
        wx.showToast({ title: '请输入调料名称', icon: 'none' })
        return
      }

      if (seasonings.find(s => s.name === customSeasoningName.trim())) {
        wx.showToast({ title: '该调料已添加', icon: 'none' })
        return
      }

      const newSeasonings = [...seasonings, {
        name: customSeasoningName.trim(),
        amount: customSeasoningAmount.trim() || '适量',
      }]

      this.setData({
        seasonings: newSeasonings,
        customSeasoningName: '',
        customSeasoningAmount: '',
      })
    },

    removeSeasoning(e: WechatMiniprogram.TouchEvent) {
      const index = e.currentTarget.dataset.index
      const seasonings = [...this.data.seasonings]
      seasonings.splice(index, 1)
      this.setData({ seasonings })
    },

    // Step 3: 清空全部调料
    clearAllSeasonings() {
      wx.showModal({
        title: '确认清空',
        content: '确定要删除全部已选调料吗？',
        confirmColor: '#ff4d4f',
        success: (res) => {
          if (res.confirm) {
            this.setData({ seasonings: [] })
          }
        },
      })
    },

    // Step 4: 步骤相关方法
    addStep() {
      const steps = [...this.data.steps, { text: '', image: '', imageUrl: '', timer: 0 }]
      this.setData({ steps })
    },

    removeStep(e: WechatMiniprogram.TouchEvent) {
      const index = e.currentTarget.dataset.index
      if (this.data.steps.length <= 1) {
        wx.showToast({ title: '至少需要一个步骤', icon: 'none' })
        return
      }
      const steps = [...this.data.steps]
      steps.splice(index, 1)
      this.setData({ steps })
    },

    moveStepUp(e: WechatMiniprogram.TouchEvent) {
      const index = e.currentTarget.dataset.index
      if (index <= 0) return
      const steps = [...this.data.steps]
      const temp = steps[index]
      steps[index] = steps[index - 1]
      steps[index - 1] = temp
      this.setData({ steps })
    },

    moveStepDown(e: WechatMiniprogram.TouchEvent) {
      const index = e.currentTarget.dataset.index
      if (index >= this.data.steps.length - 1) return
      const steps = [...this.data.steps]
      const temp = steps[index]
      steps[index] = steps[index + 1]
      steps[index + 1] = temp
      this.setData({ steps })
    },

    onStepTextInput(e: WechatMiniprogram.Input) {
      const index = e.currentTarget.dataset.index
      const steps = [...this.data.steps]
      steps[index].text = e.detail.value
      this.setData({ steps })
    },

    // Step 4: 添加步骤图片
    addStepImage(e: WechatMiniprogram.TouchEvent) {
      const index = e.currentTarget.dataset.index
      wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        success: (res) => {
          const steps = [...this.data.steps]
          steps[index].image = res.tempFiles[0].tempFilePath
          steps[index].imageUrl = ''
          this.setData({ steps })
        },
      })
    },

    // Step 4: 预览步骤图片
    previewStepImage(e: WechatMiniprogram.TouchEvent) {
      const index = e.currentTarget.dataset.index
      const step = this.data.steps[index]
      const url = step?.imageUrl || step?.image
      if (url) {
        wx.previewImage({ current: url, urls: [url] })
      }
    },

    // Step 4: 删除步骤图片
    removeStepImage(e: WechatMiniprogram.TouchEvent) {
      const index = e.currentTarget.dataset.index
      const steps = [...this.data.steps]
      steps[index].image = ''
      steps[index].imageUrl = ''
      this.setData({ steps })
    },

    // Step 4: 显示计时器选择器
    showTimerPicker(e: WechatMiniprogram.TouchEvent) {
      const index = e.currentTarget.dataset.index
      const currentTimer = this.data.steps[index].timer || 0
      const minuteIndex = this.data.timerMinutes.indexOf(Math.floor(currentTimer / 60))
      
      this.setData({
        showTimerModal: true,
        currentStepIndex: index,
        timerPickerValue: [minuteIndex > -1 ? minuteIndex : 0],
      })
    },

    hideTimerPicker() {
      this.setData({ showTimerModal: false })
    },

    onTimerPickerChange(e: WechatMiniprogram.PickerviewChange) {
      this.setData({ timerPickerValue: e.detail.value })
    },

    confirmTimer() {
      const { currentStepIndex, timerPickerValue, timerMinutes, steps } = this.data
      const minutes = timerMinutes[timerPickerValue[0]]
      const newSteps = [...steps]
      newSteps[currentStepIndex].timer = minutes * 60
      
      this.setData({
        steps: newSteps,
        showTimerModal: false,
      })
    },

    // Step 5: 基本信息输入
    setDifficulty(e: WechatMiniprogram.TouchEvent) {
      this.setData({ difficulty: parseInt(e.currentTarget.dataset.value) })
    },

    onPrepTimeInput(e: WechatMiniprogram.Input) {
      this.setData({ prepTime: e.detail.value })
    },

    onCookTimeInput(e: WechatMiniprogram.Input) {
      this.setData({ cookTime: e.detail.value })
    },

    onServingsInput(e: WechatMiniprogram.Input) {
      this.setData({ servings: e.detail.value })
    },

    onTipsInput(e: WechatMiniprogram.Input) {
      this.setData({ tips: e.detail.value })
    },

    // 步骤导航
    prevStep() {
      if (this.data.currentStep > 1) {
        this.setData({ currentStep: this.data.currentStep - 1 })
      }
    },

    nextStep() {
      const { currentStep } = this.data

      // 验证当前步骤
      if (!this.validateStep(currentStep)) {
        return
      }

      if (currentStep < 6) {
        const update: any = { currentStep: currentStep + 1 }
        // 进入预览步骤时计算菜品名称
        if (currentStep === 5) {
          update.dishName = this.getDishName()
        }
        this.setData(update)
      }
    },

    // 验证步骤
    validateStep(step: number): boolean {
      switch (step) {
        case 1:
          if (!this.data.selectedDishId && !this.data.manualDishName.trim()) {
            wx.showToast({ title: '请选择一个菜品', icon: 'none' })
            return false
          }
          return true
          
        case 4:
          const validSteps = this.data.steps.filter(s => s.text.trim())
          if (validSteps.length === 0) {
            wx.showToast({ title: '请至少添加一个步骤', icon: 'none' })
            return false
          }
          return true
          
        default:
          return true
      }
    },

    // 获取菜品名称
    getDishName(): string {
      return this.data.dishName || this.data.selectedDishName || this.data.manualDishName.trim()
    },

    // 格式化时间
    formatTime(seconds: number): string {
      const mins = Math.floor(seconds / 60)
      const secs = seconds % 60
      return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
    },

    // 提交菜谱
    async submitRecipe() {
      if (this.data.submitting) return
      this.setData({ submitting: true })
      
      try {
        const openid = app.globalData.openid

        // 上传单个文件（带重试）
        const uploadFile = async (filePath: string, prefix: string): Promise<string> => {
          if (!filePath) return ''
          if (filePath.startsWith('cloud://')) return filePath

          // 检查文件是否真实存在（旧临时路径可能已失效）
          try {
            const fs = wx.getFileSystemManager()
            await new Promise<void>((resolve, reject) => {
              fs.access({ path: filePath, success: () => resolve(), fail: reject })
            })
          } catch {
            // 文件不存在（旧 temp 路径或无效路径），跳过
            return ''
          }

          const ext = filePath.split('.').pop() || 'jpg'
          const cloudPath = `${prefix}/${openid}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
          for (let i = 0; i < 2; i++) {
            try {
              const res = await wx.cloud.uploadFile({ cloudPath, filePath })
              return res.fileID
            } catch (err) {
              console.error(`上传失败(${i + 1}/2):`, err)
              if (i === 1) throw err
              await new Promise(r => setTimeout(r, 1000))
            }
          }
          return ''
        }

        // 上传步骤图片
        const stepsWithImages = []
        for (const step of this.data.steps) {
          const imageUrl = await uploadFile(step.image, 'recipe-steps')
          stepsWithImages.push({
            text: step.text,
            image: imageUrl,
            timer: step.timer || 0,
          })
        }

        // 上传封面图
        let coverImage = await uploadFile(this.data.coverImage, 'recipe-covers')
        
        // 构建菜谱数据
        const recipeData = {
          dishId: this.data.selectedDishId || '',
          dishName: this.getDishName(),
          difficulty: this.data.difficulty,
          prepTime: parseInt(this.data.prepTime) || 0,
          cookTime: parseInt(this.data.cookTime) || 0,
          servings: parseInt(this.data.servings) || 0,
          ingredients: this.data.ingredients,
          seasonings: this.data.seasonings,
          steps: stepsWithImages,
          tips: this.data.tips,
          coverImage,
          createdByName: app.globalData.userInfo?.nickName || '',
          createdByAvatar: app.globalData.userInfo?.avatarUrl || '',
        }
        
        // 调用云函数创建/更新菜谱
        if (this.data.editMode) {
          await wx.cloud.callFunction({
            name: 'recipeOp',
            data: {
              action: 'update',
              id: this.data.editRecipeId,
              data: recipeData,
            },
          })
        } else {
          await wx.cloud.callFunction({
            name: 'recipeOp',
            data: {
              action: 'add',
              data: recipeData,
            },
          })
        }

        wx.showToast({ title: this.data.editMode ? '更新成功' : '发布成功', icon: 'success' })
        wx.setStorageSync('needsRefresh', true)
        
        setTimeout(() => {
          wx.navigateBack()
        }, 800)
        
      } catch (e) {
        console.error('发布菜谱失败', e)
        wx.showToast({ title: '发布失败，请重试', icon: 'none' })
      } finally {
        this.setData({ submitting: false })
      }
    },
  },
})
