/**
 * build-catalog.js — Heihade_index 索引生成脚本
 *
 * 功能：扫描音频仓库(Heihade_music)与图片仓库(Heihade_img)的 checkout 目录，
 *       解析各武器 <id>/dist.txt，校验资源一致性，生成 catalog.json。
 *
 * 用法：
 *   node scripts/build-catalog.js [musicDir] [imgDir] [outFile]
 *   node scripts/build-catalog.js --lint [musicDir] [imgDir]   # 只检查不生成
 *
 * 默认值：musicDir=./music  imgDir=./img  outFile=./catalog.json
 * 零第三方依赖（仅 Node 内置 fs/path）。
 */
'use strict'
const fs = require('fs')
const path = require('path')

// ===== 常量 =====
const MUSIC_BASE = 'https://MinimumBubble11.github.io/Heihade_music'
const IMG_BASE = 'https://MinimumBubble11.github.io/Heihade_img'
const DEFAULT_CATEGORY = 'other'
const DEFAULT_AUTHOR = '官方'
const DEFAULT_VIBRATION = 1500
const DEFAULT_DEBOUNCE = 0

// ===== dist.txt 解析（固定行号，换行分隔）=====
// 行1: 音效名(必填)  行2: 音效数(必填)  行3: 描述  行4: 分类
// 行5: 作者          行6: 触发参数(vibrationDuration,debounceTime)
function parseDist(content) {
  const lines = String(content || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
  const name = lines[0] || ''
  const count = parseInt(lines[1], 10)
  let vibrationDuration = DEFAULT_VIBRATION
  let debounceTime = DEFAULT_DEBOUNCE
  if (lines[5]) {
    const parts = lines[5].split(',')
    const v = parseInt(parts[0], 10)
    const d = parseInt(parts[1], 10)
    if (!isNaN(v)) vibrationDuration = v
    if (!isNaN(d)) debounceTime = d
  }
  return {
    name: name,
    count: isNaN(count) ? 0 : count,
    description: lines[2] || '',
    category: lines[3] || DEFAULT_CATEGORY,
    author: lines[4] || DEFAULT_AUTHOR,
    vibrationDuration: vibrationDuration,
    debounceTime: debounceTime
  }
}

// ===== 扫描音频目录 =====
// 单音效: <id>-audio.mp3（视为 N=0）
// 多音效: <id>-audio-1.mp3 ~ -N.mp3（按 N 升序）
function scanAudioFiles(dir) {
  let files = []
  try {
    files = fs.readdirSync(dir)
  } catch (e) {
    return []
  }
  files = files.filter((f) => /-audio(-\d+)?\.mp3$/.test(f))
  files.sort((a, b) => {
    const m1 = a.match(/-audio-(\d+)/)
    const m2 = b.match(/-audio-(\d+)/)
    const n1 = m1 ? parseInt(m1[1], 10) : 0
    const n2 = m2 ? parseInt(m2[1], 10) : 0
    return n1 - n2
  })
  return files
}

// ===== 校验音频命名与音效数一致性 =====
function validateAudioNaming(files, count) {
  if (files.length !== count) {
    return `音效数不符：dist.txt=${count} 实际文件=${files.length}`
  }
  if (count === 1 && files[0] && /-audio-\d+/.test(files[0])) {
    return '单音效应使用 <id>-audio.mp3（无数字后缀）'
  }
  if (count > 1) {
    for (let i = 0; i < count; i++) {
      if (!files[i] || !new RegExp('-audio-' + (i + 1) + '\\.mp3$').test(files[i])) {
        return '多音效应按 <id>-audio-1..' + count + '.mp3 连续命名，缺失 -' + (i + 1)
      }
    }
  }
  return null
}

// ===== 主流程 =====
function main() {
  const args = process.argv.slice(2)
  let lint = false
  if (args[0] === '--lint') {
    lint = true
    args.shift()
  }
  const musicDir = args[0] || './music'
  const imgDir = args[1] || './img'
  const outFile = args[2] || './catalog.json'

  const warnings = []
  const weapons = {}

  // 1. 收集音频仓库中含 dist.txt 的武器目录
  let ids = []
  try {
    ids = fs.readdirSync(musicDir).filter((d) => {
      const p = path.join(musicDir, d)
      return fs.statSync(p).isDirectory() && fs.existsSync(path.join(p, 'dist.txt'))
    })
  } catch (e) {
    console.error('❌ 无法读取音频目录：' + musicDir + '（请先 clone Heihade_music）')
    process.exit(1)
  }
  ids.sort()

  // 2. 逐个武器解析 + 校验
  ids.forEach((id, idx) => {
    const dir = path.join(musicDir, id)
    let distRaw = ''
    try {
      distRaw = fs.readFileSync(path.join(dir, 'dist.txt'), 'utf8')
    } catch (e) {
      warnings.push('[' + id + '] 读取 dist.txt 失败')
      return
    }
    const meta = parseDist(distRaw)
    if (!meta.name) {
      warnings.push('[' + id + '] dist.txt 缺少音效名（行1）')
      return
    }
    if (meta.count <= 0) {
      warnings.push('[' + id + '] 音效数无效（行2 需为正整数）')
      return
    }
    const audioFiles = scanAudioFiles(dir)
    const namingErr = validateAudioNaming(audioFiles, meta.count)
    if (namingErr) {
      warnings.push('[' + id + '] ' + namingErr)
      return
    }

    // 图标（图片仓库固定命名 <id>/<id>-icon.png）
    const iconFile = id + '-icon.png'
    const hasIcon = fs.existsSync(path.join(imgDir, id, iconFile))
    if (!hasIcon) {
      warnings.push('[' + id + '] 缺少图标 Heihade_img/' + id + '/' + iconFile)
    }

    weapons[id] = {
      index: idx,
      iconUrl: hasIcon ? IMG_BASE + '/' + id + '/' + iconFile : '',
      audioUrls: audioFiles.map((f) => MUSIC_BASE + '/' + id + '/' + f),
      name: meta.name,
      description: meta.description,
      category: meta.category,
      author: meta.author,
      vibrationDuration: meta.vibrationDuration,
      debounceTime: meta.debounceTime,
      isVip: true
    }
  })

  // 3. 告警输出
  if (warnings.length > 0) {
    console.warn('=== 一致性告警（' + warnings.length + '）===')
    warnings.forEach((w) => console.warn(' - ' + w))
  } else {
    console.log('✓ 一致性校验通过')
  }

  if (lint) {
    console.log('lint 完成：有效武器 ' + Object.keys(weapons).length + '，告警 ' + warnings.length)
    return
  }

  // 4. 生成 catalog.json
  const catalog = {
    version: new Date().toISOString(),
    weapons: weapons
  }
  try {
    fs.writeFileSync(outFile, JSON.stringify(catalog, null, 2), 'utf8')
    console.log('✓ 已生成 ' + outFile + '（武器 ' + Object.keys(weapons).length + ' 个）')
  } catch (e) {
    console.error('❌ 写入失败：' + e.message)
    process.exit(1)
  }
}

main()
