import { useId } from 'react'

export function BrandMark({ size = 26 }: { size?: number }): React.JSX.Element {
  const id = useId().replace(/:/g, '')
  const gradient = `hs-grad-${id}`
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id={gradient} x1="4" y1="2" x2="44" y2="46" gradientUnits="userSpaceOnUse">
          <stop stopColor="#7CB2FF" />
          <stop offset="0.48" stopColor="#8B5CF6" />
          <stop offset="1" stopColor="#22D3EE" />
        </linearGradient>
        <linearGradient id={`${gradient}-shine`} x1="8" y1="4" x2="26" y2="30" gradientUnits="userSpaceOnUse">
          <stop stopColor="white" stopOpacity="0.42" />
          <stop offset="1" stopColor="white" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="44" height="44" rx="13" fill={`url(#${gradient})`} />
      <rect x="3.5" y="3.5" width="41" height="41" rx="11.5" stroke="white" strokeOpacity="0.22" strokeWidth="1" />
      <path d="M15.5 14.5V33.5" stroke="white" strokeWidth="4.4" strokeLinecap="round" />
      <path d="M32.5 14.5V33.5" stroke="white" strokeWidth="4.4" strokeLinecap="round" />
      <path d="M16 24H32" stroke="white" strokeWidth="4.4" strokeLinecap="round" />
      <circle cx="34.5" cy="13.5" r="2.6" fill="white" fillOpacity="0.92" />
      <path d="M6 8C6 6.89543 6.89543 6 8 6H26L8 24V8Z" fill={`url(#${gradient}-shine)`} />
    </svg>
  )
}
