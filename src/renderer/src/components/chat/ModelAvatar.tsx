/** Renders a model's brand logo, falling back to the first letter of the model name. */

import type { ModelLogoSource } from '@renderer/utils/modelLogos'
import { getModelLogo } from '@renderer/utils/modelLogos'
import type { AvatarProps } from 'antd'
import { Avatar } from 'antd'
import type { ReactNode } from 'react'
import styles from './ModelAvatar.module.scss'

interface ModelAvatarProps {
  model?: ModelLogoSource
  size?: number
  fallback?: ReactNode
  props?: AvatarProps
}

/** Displays the logo or fallback character for a selectable chat model. */
const ModelAvatar = ({
  model,
  size = 20,
  fallback,
  props,
}: ModelAvatarProps): React.JSX.Element => (
  <Avatar
    {...props}
    src={getModelLogo(model)}
    size={size}
    className={`${styles.avatar} ${props?.className ?? ''}`}
  >
    {model?.name ? model.name.charAt(0) : (fallback ?? undefined)}
  </Avatar>
)

export default ModelAvatar
