/// <reference types="vite/client" />

import type { DetailedHTMLProps, HTMLAttributes } from 'react'
import type { StudioApi } from '@shared/types'

declare global {
  interface Window {
    studio: StudioApi
  }
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      webview: DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string
        partition?: string
        allowpopups?: string
        webpreferences?: string
      }
    }
  }
}

export {}
