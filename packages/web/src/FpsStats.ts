/**
 * fps 采集脚本
 */

const FPS_EX_HIGH = 144
const FPS_HIGH = 120
const FPS_NORMAL = 60
const RATED_FRAME_NUM = 3
const NORMAL_FRAME_TIME = 16
const HIGH_FRAME_TIME = 8

let isInited = false

interface Stats {
  /** 是否触发低 fps 条件 */
  isLow: boolean
  /** fps 样本列表 */
  samples: number[]
  /** 低 fps 样本列表 */
  lowSamples: number[]
  /** 低 fps 占样本比例 */
  lowPercent: number
  /** 根据帧时间推算出的屏幕额定帧率 */
  ratedFps: number
}

interface ReportData {
  /** fps 统计信息 */
  stats: Stats
  /** 触发采集的事件对象 */
  event: Event
  /** 扩展数据 */
  extra: {
    scrollY: number[]
  }
}

interface Params {
  /** 低 fps 下限阈值，传这个值，则 lowThresholdPercent 失效 */
  lowThreshold?: number
  /** 低 fps 下限阈值百分比, 如 低于屏幕额定 fps(60) 的60%(即 36)认为是低fps，则传 0.6 */
  lowThresholdPercent?: number
  /** 低 fps 样本数百分比，如低样本数占总样本数 30% 认为是低fps，则传 0.3 */
  lowSamplePercent?: number
  /** 采集时长 ms，采集一段时间内的样本, 时长越长，低 fps 判断越准确 */
  collectDuration?: number
  /** 采集间隔 ms，会将间隔内的帧数相加，然后计算平均值，间隔越短，灵敏度越高 */
  collectInterval?: number
  /** 采集最大次数，达到采集最大次数则自动停止采集, 默认不限制 */
  collectMaxCount?: number
  /** 触发采集的事件 */
  monitorEvents?: Array<'DOMContentLoaded' | 'scroll' | 'click'>
  /** 采集结果上报函数 */
  report?: (d: ReportData) => void
}

export class FpsStats {
  collectPromise: Promise<number[]> | null = null
  lowThreshold = 0
  lowThresholdPercent = 0
  lowSamplePercent = 0
  collectInterval = 0
  collectDuration = 0
  collectMaxCount = 0
  collectCount = 0
  monitorEvents: Array<'DOMContentLoaded' | 'scroll' | 'click'> = []
  normalRefreshNum = 0
  highRefreshNum = 0
  exHighRefreshNum = 0
  ratedFpsCache = 0
  monitorHandlers: Record<string, (e: Event) => Promise<void>> = {}
  report: Params['report']

  constructor({
    lowThreshold = 0,
    lowThresholdPercent = 0.5,
    lowSamplePercent = 0.5,
    collectDuration = 10 * 1000,
    collectInterval = 1000,
    collectMaxCount = 0,
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
      !isNaN(lowThreshold) ||
      (lowThreshold && (lowThreshold < 0 || lowThreshold >= FPS_NORMAL))
    ) {
      console.warn(`${name}: lowThreshold 必须是小于浏览器额定帧率的整数`)
      return
    }
    if (
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
    this.lowThresholdPercent = lowThresholdPercent
    this.lowSamplePercent = lowSamplePercent
    this.collectDuration = collectDuration
    this.collectInterval = collectInterval
    this.collectMaxCount = collectMaxCount
    this.monitorEvents = monitorEvents
    this.lowThreshold = lowThreshold
    this.report = report
    this.monitorHandlers = {}
  }

  get ratedFps() {
    if (this.ratedFpsCache) return this.ratedFpsCache

    if (this.exHighRefreshNum > RATED_FRAME_NUM) {
      this.ratedFpsCache = FPS_EX_HIGH
    } else if (this.highRefreshNum > RATED_FRAME_NUM) {
      this.ratedFpsCache = FPS_HIGH
    } else if (this.normalRefreshNum > RATED_FRAME_NUM) {
      this.ratedFpsCache = FPS_NORMAL
    } else {
      this.ratedFpsCache = 0
      this.exHighRefreshNum = 0
      this.highRefreshNum = 0
      this.normalRefreshNum = 0
    }
    return this.ratedFpsCache
  }

  calculateRatedFps(frameTime: number) {
    if (this.ratedFpsCache) return

    if (frameTime < HIGH_FRAME_TIME) {
      this.exHighRefreshNum += 1
    } else if (frameTime < NORMAL_FRAME_TIME) {
      this.highRefreshNum += 1
    } else {
      this.normalRefreshNum += 1
    }
  }

  collect() {
    if (this.collectPromise) return this.collectPromise
    this.collectPromise = new Promise((resolve) => {
      const startTime = Date.now()
      let periodStartTime = 0
      let prevTime = 0
      let frames = 0
      const samples: number[] = []
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      const self = this
      function doCollect(this: FpsStats, time: number) {
        if (!periodStartTime) {
          periodStartTime = time
        } else {
          frames += 1
          const period = time - periodStartTime
          const frameTime = time - prevTime
          this.calculateRatedFps(frameTime)
          if (period >= this.collectInterval) {
            const fps = Math.round((frames / period) * 1000)
            samples.push(fps)
            periodStartTime = time
            frames = 0
          }
          if (Date.now() - startTime > this.collectDuration) {
            this.collectPromise = null
            return resolve(samples)
          }
        }
        prevTime = time
        window.requestAnimationFrame(doCollect.bind(self))
      }
      window.requestAnimationFrame(doCollect.bind(self))
    })
    return this.collectPromise
  }

  async getStats() {
    const samples = await this.collect()
    const lowThreshold =
      this.lowThreshold || this.ratedFps * this.lowThresholdPercent
    const lowSamples = samples.filter((fps) => fps <= lowThreshold)
    let isLow = false
    const lowPercent = lowSamples.length / samples.length
    if (!samples.length || lowPercent >= this.lowSamplePercent) {
      isLow = true
    }
    return {
      isLow,
      samples,
      lowSamples,
      lowPercent: Math.round(lowPercent * 10) / 10,
      ratedFps: this.ratedFps,
    }
  }

  startMonitor() {
    let isCollecting = false
    this.monitorEvents.forEach((eventType) => {
      if (this.monitorHandlers[eventType]) {
        return
      }
      const handler = async (event: Event) => {
        if (
          this.collectMaxCount > 0 &&
          this.collectCount > this.collectMaxCount
        ) {
          return this.stopMonitor()
        }
        if (!isCollecting) {
          this.collectCount += 1
          isCollecting = true
          try {
            const scrollYStart = Math.round(
              window.scrollY ?? window.pageYOffset ?? 0,
            )
            const stats = await this.getStats()
            if (typeof this.report === 'function') {
              const scrollYEnd = Math.round(
                window.scrollY ?? window.pageYOffset ?? 0,
              )
              const extra = {
                scrollY: [scrollYStart, scrollYEnd],
              }
              this.report({ stats, event, extra })
            }
            isCollecting = false
          } catch (err) {}
        }
      }
      window.addEventListener(eventType, handler, {
        passive: eventType === 'scroll' ? true : undefined,
      })
      this.monitorHandlers[eventType] = handler
    })
  }

  stopMonitor(events: string[] = []) {
    let stopEvents = events
    if (!events.length) {
      stopEvents = this.monitorEvents
    }
    stopEvents.forEach((eventType) => {
      const handler = this.monitorHandlers[eventType]
      if (handler) {
        window.removeEventListener(eventType, handler)
        delete this.monitorHandlers[eventType]
      }
    })
  }
}
