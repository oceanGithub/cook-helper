interface SpotData {
  name: string
  city: string
  district: string
  address: string
  latitude: number
  longitude: number
  travelMethod: string
  travelNote: string
  playType: string
  playTypeNote: string
  coverImage: string
  images: string[]
  note: string
  rating: number
}

interface CityItem {
  city: string
  districts: string[]
}

const guangdongCities: CityItem[] = [
  { city: '广州市', districts: ['越秀区', '海珠区', '荔湾区', '天河区', '白云区', '黄埔区', '番禺区', '花都区', '南沙区', '从化区', '增城区'] },
  { city: '深圳市', districts: ['福田区', '罗湖区', '南山区', '盐田区', '宝安区', '龙岗区', '龙华区', '坪山区', '光明区', '大鹏新区'] },
  { city: '珠海市', districts: ['香洲区', '金湾区', '斗门区'] },
  { city: '汕头市', districts: ['金平区', '龙湖区', '濠江区', '潮阳区', '潮南区', '澄海区', '南澳县'] },
  { city: '佛山市', districts: ['禅城区', '南海区', '顺德区', '三水区', '高明区'] },
  { city: '韶关市', districts: ['武江区', '浈江区', '曲江区', '始兴县', '仁化县', '翁源县', '乳源县', '新丰县', '乐昌市', '南雄市'] },
  { city: '湛江市', districts: ['赤坎区', '霞山区', '坡头区', '麻章区', '遂溪县', '徐闻县', '廉江市', '雷州市', '吴川市'] },
  { city: '肇庆市', districts: ['端州区', '鼎湖区', '高要区', '广宁县', '怀集县', '封开县', '德庆县', '四会市'] },
  { city: '江门市', districts: ['蓬江区', '江海区', '新会区', '台山市', '开平市', '鹤山市', '恩平市'] },
  { city: '茂名市', districts: ['茂南区', '电白区', '高州市', '化州市', '信宜市'] },
  { city: '惠州市', districts: ['惠城区', '惠阳区', '博罗县', '惠东县', '龙门县'] },
  { city: '梅州市', districts: ['梅江区', '梅县区', '大埔县', '丰顺县', '五华县', '平远县', '蕉岭县', '兴宁市'] },
  { city: '汕尾市', districts: ['城区', '海丰县', '陆河县', '陆丰市'] },
  { city: '河源市', districts: ['源城区', '紫金县', '龙川县', '连平县', '和平县', '东源县'] },
  { city: '阳江市', districts: ['江城区', '阳东区', '阳西县', '阳春市'] },
  { city: '清远市', districts: ['清城区', '清新区', '佛冈县', '阳山县', '连山县', '连南县', '英德市', '连州市'] },
  { city: '东莞市', districts: ['东莞市'] },
  { city: '中山市', districts: ['中山市'] },
  { city: '潮州市', districts: ['湘桥区', '潮安区', '饶平县'] },
  { city: '揭阳市', districts: ['榕城区', '揭东区', '揭西县', '惠来县', '普宁市'] },
  { city: '云浮市', districts: ['云城区', '云安区', '新兴县', '郁南县', '罗定市'] },
]

const playTypes = [
  { value: 'eat-play', label: '吃喝玩乐' },
  { value: 'camping', label: '露营' },
  { value: 'picnic', label: '野餐' },
  { value: 'hiking', label: '徒步' },
  { value: 'climbing', label: '爬山' },
  { value: 'other', label: '其他' },
]

Component({
  data: {
    // 表单字段
    spotName: '',
    cityIndex: -1,
    districtIndex: -1,
    address: '',
    latitude: 0,
    longitude: 0,
    travelMethod: 'other' as string,
    travelNote: '',
    playType: 'eat-play' as string,
    playTypeNote: '',
    coverImage: '',
    images: [] as string[],
    note: '',
    rating: 3,

    // 选项数据
    cityList: guangdongCities.map(c => c.city),
    districtList: [] as string[],
    playTypes: playTypes,

    // 状态
    saving: false,
    isEdit: false,
    editId: '',
    showForm: true,
    showCityDistrict: false,
    spotNameFocused: false,
    noteFocused: false,
    travelNoteFocused: false,
    playTypeNoteFocused: false,
  },

  lifetimes: {
    attached() {
      // 检查是否编辑模式
      const editId = wx.getStorageSync('editSpotId')
      if (editId) {
        this.setData({ isEdit: true, editId })
        wx.removeStorageSync('editSpotId')
        this.loadSpotDetail(editId)
      }
    },
  },

  methods: {
    // 加载详情（编辑模式）
    async loadSpotDetail(id: string) {
      try {
        const db = wx.cloud.database()
        const res = await db.collection('leisureSpots').doc(id).get()
        const spot = res.data
        const cityIdx = guangdongCities.findIndex(c => c.city === spot.city)
        const districts = cityIdx >= 0 ? guangdongCities[cityIdx].districts : []
        const districtIdx = districts.indexOf(spot.district)

        this.setData({
          spotName: spot.name,
          cityIndex: cityIdx,
          districtList: districts,
          districtIndex: districtIdx,
          address: spot.address,
          latitude: spot.latitude,
          longitude: spot.longitude,
          travelMethod: spot.travelMethod || 'other',
          travelNote: spot.travelNote || '',
          playType: spot.playType || 'eat-play',
          playTypeNote: spot.playTypeNote || '',
          coverImage: spot.coverImage || '',
          images: spot.images || [],
          note: spot.note || '',
          rating: spot.rating || 5,
          showCityDistrict: true,
        })
      } catch (err) {
        console.error('加载详情失败:', err)
        wx.showToast({ title: '加载失败', icon: 'none' })
      }
    },

    // 城市选择
    onCityChange(e: WechatMiniprogram.PickerChange) {
      const cityIndex = Number(e.detail.value)
      this.setData({
        cityIndex,
        districtIndex: -1,
        districtList: guangdongCities[cityIndex].districts,
      })
    },

    // 区选择
    onDistrictChange(e: WechatMiniprogram.PickerChange) {
      this.setData({ districtIndex: Number(e.detail.value) })
    },

    // 地图选点
    chooseLocation() {
      // 隐藏表单，防止 Skyline 渲染器下表单元素穿透地图
      this.setData({ showForm: false })
      wx.chooseLocation({
        success: (res) => {
          // 优先使用 address（完整地址），如果没有则拼接 name
          let fullAddress = res.address || ''
          if (res.name && res.address && !res.address.includes(res.name)) {
            fullAddress = res.name + ' ' + res.address
          } else if (res.name && !res.address) {
            fullAddress = res.name
          }

          // 从地址字符串中解析城市和区
          let cityIndex = -1
          let districtIndex = -1
          let districtList: string[] = []

          // 解析地址格式：广东省深圳市南山区xxx路
          const addressToParse = fullAddress || res.address || ''
          console.log('解析地址:', addressToParse)

          // 遍历广东省所有城市和区进行匹配
          for (let i = 0; i < guangdongCities.length; i++) {
            const cityItem = guangdongCities[i]
            const cityName = cityItem.city.replace('市', '') // "深圳" 或 "广州"

            if (addressToParse.includes(cityName)) {
              cityIndex = i
              districtList = cityItem.districts

              // 匹配区
              for (let j = 0; j < cityItem.districts.length; j++) {
                const districtName = cityItem.districts[j].replace('区', '').replace('县', '').replace('市', '')
                if (addressToParse.includes(districtName)) {
                  districtIndex = j
                  break
                }
              }
              break
            }
          }

          console.log('匹配结果 - 城市索引:', cityIndex, '区域索引:', districtIndex)

          this.setData({
            address: fullAddress,
            latitude: res.latitude,
            longitude: res.longitude,
            showForm: true,
            showCityDistrict: true,
            cityIndex,
            districtIndex,
            districtList,
          })
        },
        fail: (err) => {
          console.log('选择位置取消或失败:', err)
          this.setData({ showForm: true })
        },
      })
    },

    // 出行方式选择
    onTravelMethodChange(e: WechatMiniprogram.RadioGroupChange) {
      this.setData({ travelMethod: e.detail.value as string })
    },

    // 出行方式补充说明
    onTravelNoteInput(e: WechatMiniprogram.Input) {
      this.setData({ travelNote: e.detail.value })
    },

    // 游玩类型选择
    onPlayTypeTap(e: WechatMiniprogram.TouchEvent) {
      const value = e.currentTarget.dataset.value
      this.setData({ playType: value })
    },

    // 游玩类型补充说明
    onPlayTypeNoteInput(e: WechatMiniprogram.Input) {
      this.setData({ playTypeNote: e.detail.value })
    },

    // 选择封面图
    chooseCoverImage() {
      wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        success: (res) => {
          this.setData({ coverImage: res.tempFiles[0].tempFilePath })
        },
      })
    },

    // 删除封面图
    removeCoverImage() {
      this.setData({ coverImage: '' })
    },

    // 预览封面图
    previewCoverImage() {
      if (this.data.coverImage) {
        wx.previewImage({ urls: [this.data.coverImage] })
      }
    },

    // 选择游玩图片
    chooseImages() {
      const remaining = 9 - this.data.images.length
      if (remaining <= 0) {
        wx.showToast({ title: '最多上传9张图片', icon: 'none' })
        return
      }
      wx.chooseMedia({
        count: remaining,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        success: (res) => {
          const newImages = res.tempFiles.map(f => f.tempFilePath)
          this.setData({ images: [...this.data.images, ...newImages] })
        },
      })
    },

    // 删除游玩图片
    removeImage(e: WechatMiniprogram.TouchEvent) {
      const index = e.currentTarget.dataset.index
      const images = [...this.data.images]
      images.splice(index, 1)
      this.setData({ images })
    },

    // 预览游玩图片
    previewImage(e: WechatMiniprogram.TouchEvent) {
      const index = e.currentTarget.dataset.index
      wx.previewImage({
        urls: this.data.images,
        current: this.data.images[index],
      })
    },

    // 星级评分
    onRatingTap(e: WechatMiniprogram.TouchEvent) {
      const rating = e.currentTarget.dataset.rating
      this.setData({ rating })
    },

    // 输入框聚焦
    onInputFocus(field: string) {
      this.setData({ [field]: true })
    },
    onInputBlur(field: string) {
      this.setData({ [field]: false })
    },

    // 目的地名称输入
    onNameInput(e: WechatMiniprogram.Input) {
      this.setData({ spotName: e.detail.value })
    },

    // 游玩心得输入
    onNoteInput(e: WechatMiniprogram.Input) {
      this.setData({ note: e.detail.value })
    },

    // 上传图片到云存储
    async uploadFile(filePath: string, prefix: string): Promise<string> {
      if (!filePath) return ''
      if (filePath.startsWith('cloud://')) return filePath
      const ext = filePath.split('.').pop() || 'jpg'
      const cloudPath = `${prefix}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
      const res = await wx.cloud.uploadFile({ cloudPath, filePath })
      return res.fileID
    },

    // 提交表单
    async submitForm() {
      const { spotName, cityIndex, districtIndex, districtList, address, latitude, longitude,
        travelMethod, travelNote, playType, playTypeNote, coverImage, images, note, rating, showCityDistrict } = this.data

      // 验证必填项
      if (!spotName.trim()) {
        wx.showToast({ title: '请输入目的地名称', icon: 'none' })
        return
      }
      if (!address || !latitude || !longitude) {
        wx.showToast({ title: '请选择目的地位置', icon: 'none' })
        return
      }
      if (showCityDistrict && cityIndex < 0) {
        wx.showToast({ title: '请选择归属城市', icon: 'none' })
        return
      }
      if (showCityDistrict && districtIndex < 0) {
        wx.showToast({ title: '请选择所属区', icon: 'none' })
        return
      }

      this.setData({ saving: true })
      wx.showLoading({ title: '保存中...' })

      try {
        // 上传图片
        let coverFileId = ''
        const imageFileIds: string[] = []

        if (coverImage && !coverImage.startsWith('cloud://')) {
          coverFileId = await this.uploadFile(coverImage, 'leisure-covers')
        } else {
          coverFileId = coverImage
        }

        for (const img of images) {
          if (img.startsWith('cloud://')) {
            imageFileIds.push(img)
          } else {
            const fileId = await this.uploadFile(img, 'leisure-images')
            imageFileIds.push(fileId)
          }
        }

        const city = guangdongCities[cityIndex].city
        const district = districtList[districtIndex]

        const spotData: Partial<SpotData> = {
          name: spotName.trim(),
          city,
          district,
          address,
          latitude,
          longitude,
          travelMethod,
          travelNote: travelNote.trim(),
          playType,
          playTypeNote: playType === 'other' ? playTypeNote.trim() : '',
          coverImage: coverFileId,
          images: imageFileIds,
          note: note.trim(),
          rating,
        }

        const db = wx.cloud.database()

        if (this.data.isEdit && this.data.editId) {
          await db.collection('leisureSpots').doc(this.data.editId).update({
            data: { ...spotData, updatedAt: db.serverDate() },
          })
        } else {
          // 获取用户信息和openid
          const app = getApp<IAppOption>()
          const userInfo = app.globalData.userInfo
          const { openid } = await wx.cloud.callFunction({ name: 'login' }).then(r => r.result as { openid: string })

          await db.collection('leisureSpots').add({
            data: {
              ...spotData,
              createdBy: openid,
              createdByName: userInfo?.nickName || '匿名用户',
              createdByAvatar: userInfo?.avatarUrl || '',
              createdAt: db.serverDate(),
            },
          })
        }

        wx.hideLoading()
        wx.showToast({ title: '发布成功', icon: 'success' })
        wx.setStorageSync('needsRefresh', true)
        setTimeout(() => wx.navigateBack(), 800)
      } catch (err) {
        console.error('保存失败:', err)
        wx.hideLoading()
        wx.showToast({ title: '保存失败，请重试', icon: 'none' })
      } finally {
        this.setData({ saving: false })
      }
    },
  },
})
