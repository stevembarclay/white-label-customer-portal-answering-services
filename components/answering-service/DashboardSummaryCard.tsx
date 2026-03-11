'use client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ArrowRight } from '@phosphor-icons/react'
import type { SVGProps } from 'react'
type IconComponent = React.ComponentType<SVGProps<SVGSVGElement>>
interface DashboardSummaryCardProps {
  title: string
  value: string | number
  subtitle?: string
  icon?: IconComponent
  isLoading?: boolean
  clickable?: boolean
}
export function DashboardSummaryCard({
  title,
  value,
  subtitle,
  icon: Icon,
  isLoading = false,
  clickable = false,
}: DashboardSummaryCardProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-4 w-24" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-8 w-32 mb-2" />
          {subtitle && <Skeleton className="h-3 w-40" />}
        </CardContent>
      </Card>
    )
  }
  return (
    <Card className={clickable ? 'cursor-pointer transition-all hover:border-slate-300 hover:shadow-md group-hover:border-slate-300' : ''}>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {Icon && <Icon className="w-5 h-5 text-primary" />}
            <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
          </div>
          {clickable && (
            <ArrowRight className="w-4 h-4 text-muted-foreground opacity-60 transition-opacity group-hover:opacity-100 group-hover:translate-x-1" />
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold text-foreground">{value}</div>
        {subtitle && (
          <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
        )}
      </CardContent>
    </Card>
  )
}
