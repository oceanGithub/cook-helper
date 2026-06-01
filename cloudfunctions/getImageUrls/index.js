const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async (event) => {
  const fileIds = event.fileIds
  if (!fileIds || fileIds.length === 0) return { urlMap: {} }

  var cloudFiles = []
  for (var i = 0; i < fileIds.length; i++) {
    if (fileIds[i] && fileIds[i].indexOf('cloud://') === 0) {
      cloudFiles.push(fileIds[i])
    }
  }
  if (cloudFiles.length === 0) return { urlMap: {} }

  var urlMap = {}
  for (var i = 0; i < cloudFiles.length; i += 50) {
    var batch = cloudFiles.slice(i, i + 50)
    var res = await cloud.getTempFileURL({ fileList: batch })
    var fileList = res.fileList || []
    for (var j = 0; j < fileList.length; j++) {
      if (fileList[j].tempFileURL) {
        urlMap[fileList[j].fileID] = fileList[j].tempFileURL
      }
    }
  }
  return { urlMap: urlMap }
}
