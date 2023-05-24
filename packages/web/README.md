# stats-web
web 页面统计脚本，采集页面行为数据，如 fps 等

## FpsStats 类
采集页面 fps 数据，并自动检测浏览器额定帧率，支持定义低帧率阈值，以及采样配置, 支持自定义事件触发采集，精确获取帧率信息，及分析结果
### 使用示例
```
  import { FpsStats } from '@inventorjs/stats-web'
  const fpsStats = new FpsStats({
    // 可定制其他采集配置参数
    // ...
    report({ stats, event }) {
      // stats 为采集的帧率信息 Stats
      // event 为触发采集的事件对象 Event
      // 这里可以执行相应的上报逻辑，上报至自己的数据接口，进行数据分析和告警
    }
  })
  // 开始监控采集 fps
  fpsStats.startMonitor()

  // 可随时暂停采集
  fpsStats.stopMonitor()
```

### 数据结构定义
```
// 采集对象构造参数
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

// 采集数据结构如下
interface ReportData {
  /** fps 统计信息 */
  stats: Stats
  /** 触发采集的事件对象 */
  event: Event
}

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
```
