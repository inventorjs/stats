/**
 * fps 采集脚本
 */

const FPS_HIGHT = 120
const FPS_NORMAL = 60
const NORMAL_FRAME_TIME = 16

let isInited = false

interface Stats {
  /** 是否触发低 fps 条件 */
  isLow: boolean
  /** fps 样本列表 */
  samples: number[]
  /** 低 fps 样本列表 */
  lowSamples: number[]
  /** 是否是高刷屏, 通过帧之间的间隔获取，如何 60hz 为 16.6ms，120hz 为 8.3ms, 侦测到存在帧时长<16ms 则认为是高刷屏 */
  isHighScreen: boolean
}

interface ReportData {
  /** fps 统计信息 */
  stats: Stats
  /** 触发采集的事件对象 */
  event: Event
}

interface Params {
  /** 低 fps 下限阈值百分比, 如 低于屏幕额定 fps(60) 的60%(即 36)认为是低fps，则传 0.6 */
  lowThresholdPercent?: number
  /** 低 fps 样本数百分比，如低样本数占总样本数 30% 认为是低fps，则传 0.3 */
  lowSamplePercent?: number
  /** 采集时长 ms，采集一段时间内的样本 */
  collectDuration?: number
  /** 采集间隔 ms，会将间隔内的帧数相加，然后计算平均值，增加准确性 */
  collectInterval?: number
  /** 触发采集的事件 */
  monitorEvents?: Array<'DOMContentLoaded' | 'scroll' | 'click'>
  /** 采集结果上报函数 */
  report?: (d: ReportData) => void
}

export class FpsStats {
  collectPromise: Promise<number[]> | null = null
  sampleSize = 0
  lowThresholdPercent = 0
  collectInterval = 0
  monitorEvents: Array<'DOMContentLoaded' | 'scroll' | 'click'> = []
  lowSampleSize = 0
  highRefreshNum = 0
  monitorHandlers: Record<string, Array<(e: Event) => Promise<void>>> = {}
  report: Params['report']

  constructor({
    lowThresholdPercent = 0.6,
    lowSamplePercent = 0.3,
    collectDuration = 10 * 1000,
    collectInterval = 1000,
    monitorEvents = ['DOMContentLoaded', 'scroll', 'click'],
    report,
  }: Params = {}) {
    const name = this.constructor.name
    if (isInited) {
      console.warn(`${name}: 实例初始化失败, 当前统计对象仅支持单个实例`)
      return
    }
    if (typeof Promise === 'undefined') {
      console.warn(`${name}: 实例初始化失败, 当前环境未支持 Promise`)
      return
    }
    if (
      !Number(collectInterval) ||
      !Number(collectDuration) ||
      collectInterval < 0 ||
      collectDuration < 0
    ) {
      console.warn(
        `${name}: collectInterval 和 collectDuration 必须是一个正整数`,
      )
      return
    }
    if (collectInterval > collectDuration) {
      console.warn(
        `${name}: collectInterval 必须小于 collectDuration 以采集正确的样本数`,
      )
      return
    }
    if (
      !Number(lowThresholdPercent) ||
      !Number(lowThresholdPercent) ||
      lowThresholdPercent < 0 ||
      lowThresholdPercent > 1
    ) {
      console.warn(`${name}: lowThresholdPercent 必须是[0, 1]之间的小数`)
      return
    }
    if (
      !Number(lowSamplePercent) ||
      lowSamplePercent < 0 ||
      lowSamplePercent > 1
    ) {
      console.warn(`${name}: lowSamplePercent 必须是[0, 1]之间的小数`)
      return
    }
    isInited = true
    this.sampleSize = collectDuration / collectInterval
    this.lowThresholdPercent = lowThresholdPercent
    this.collectInterval = collectInterval
    this.monitorEvents = monitorEvents
    this.lowSampleSize = this.sampleSize * lowSamplePercent
    this.report = report
    this.highRefreshNum = 0
    this.monitorHandlers = {}
  }

  get isHighScreen() {
    return this.highRefreshNum > 5
  }

  collect() {
    if (this.collectPromise) return this.collectPromise
    this.collectPromise = new Promise((resolve) => {
      let startTime = 0
      let frames = 0
      const samples: number[] = []
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      const self = this
      function doCollect(this: FpsStats, time: number) {
        if (!startTime) {
          startTime = time
        } else {
          frames += 1
          const endTime = time
          const period = endTime - startTime
          if (!this.isHighScreen && period < NORMAL_FRAME_TIME) {
            this.highRefreshNum += 1
          }
          if (period >= this.collectInterval) {
            const fps = Math.round((frames / period) * 1000)
            samples.push(fps)
            startTime = endTime
            frames = 0
          }
          if (samples.length >= this.sampleSize) {
            this.collectPromise = null
            return resolve(samples)
          }
        }
        window.requestAnimationFrame(doCollect.bind(self))
      }
      window.requestAnimationFrame(doCollect.bind(self))
    })
    return this.collectPromise
  }

  async getStats() {
    const samples = await this.collect()
    const screenFps = this.isHighScreen ? FPS_HIGHT : FPS_NORMAL
    const lowSamples = samples.filter(
      (fps) => fps <= screenFps * this.lowThresholdPercent,
    )
    let isLow = false
    if (lowSamples.length >= this.lowSampleSize) {
      isLow = true
    }
    return { isLow, samples, lowSamples, isHighScreen: this.isHighScreen }
  }

  startMonitor() {
    let isCollecting = false
    this.monitorEvents.forEach((eventType) => {
      const handler = async (event: Event) => {
        if (!isCollecting) {
          isCollecting = true
          try {
            const stats = await this.getStats()
            if (typeof this.report === 'function') {
              this.report({ stats, event })
            }
            isCollecting = false
          } catch (err) {}
        }
      }
      window.addEventListener(eventType, handler, {
        passive: eventType === 'scroll' ? true : undefined,
      })
      this.monitorHandlers[eventType] = [handler]
    })
  }

  stopMonitor(events: string[] = []) {
    let stopEvents = events
    if (!events.length) {
      stopEvents = this.monitorEvents
    }
    stopEvents.forEach((eventType) => {
      const handler = this.monitorHandlers[eventType]?.[0]
      if (handler) {
        window.removeEventListener(eventType, handler)
        delete this.monitorHandlers[eventType][0]
      }
    })
  }
}
