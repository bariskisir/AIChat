/** Remark plugin to disable specific markdown constructs. */

import type { Root } from 'mdast'
import type { Plugin } from 'unified'

/** Appends one micromark extension value to a mutable processor data field. */
function add(data: Record<string, unknown>, field: string, value: unknown): void {
  let list = data[field] as unknown[] | undefined
  if (!list) {
    list = []
    data[field] = list
  }
  list.push(value)
}

/** Disables micromark constructs such as indented code blocks. */
function remarkDisableConstructs(constructs: string[] = []): Plugin<[], Root, Root> {
  return function () {
    const data = this.data() as Record<string, unknown>

    if (constructs.length > 0) {
      const disableExtension = {
        disable: {
          null: constructs,
        },
      }

      add(data, 'micromarkExtensions', disableExtension)
    }
  }
}

export default remarkDisableConstructs
