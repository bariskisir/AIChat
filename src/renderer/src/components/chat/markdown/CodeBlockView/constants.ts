/** Languages that render a diagram preview instead of plain source. */

import GraphvizPreview from './GraphvizPreview'
import MermaidPreview from './MermaidPreview'
import PlantUmlPreview from './PlantUmlPreview'
import SvgPreview from './SvgPreview'

/** Languages with a dedicated preview component. */
export const SPECIAL_VIEWS = ['mermaid', 'plantuml', 'svg', 'dot', 'graphviz'] as const

/** Maps each preview language to its renderer component. */
export const SPECIAL_VIEW_COMPONENTS = {
  mermaid: MermaidPreview,
  plantuml: PlantUmlPreview,
  svg: SvgPreview,
  dot: GraphvizPreview,
  graphviz: GraphvizPreview,
} as const

/** Maximum source height before the collapse/expand toolbar appears. */
export const MAX_COLLAPSED_CODE_HEIGHT = 350
