'use client';

import React, { forwardRef } from 'react';
import { motion, HTMLMotionProps } from 'framer-motion';
import { cn } from '@/lib/utils';
import { cva, type VariantProps } from 'class-variance-authority';

// Unified Card System - 2025 Modern Design
const cardVariants = cva(
  // Base styles
  [
    "relative overflow-hidden rounded-2xl border transition-all duration-300",
    "backdrop-blur-xl bg-white/10 dark:bg-black/20",
    "border-white/20 dark:border-white/10",
    "shadow-lg hover:shadow-xl",
    "transform-gpu will-change-transform", // GPU acceleration
  ],
  {
    variants: {
      variant: {
        // Modern Glass variants
        glass: "glass-elevated",
        "glass-magnetic": "glass-elevated magnetic-btn",
        "glass-spotlight": "glass-elevated spotlight-card",
        "glass-float": "glass-elevated hover:-translate-y-2 hover:shadow-2xl",
        
        // Modern Surface variants
        surface: [
          "bg-white/90 dark:bg-slate-900/90",
          "border-white/30 dark:border-slate-700/30",
          "shadow-lg hover:shadow-xl"
        ],
        "surface-elevated": [
          "bg-white/95 dark:bg-slate-900/95",
          "border-white/40 dark:border-slate-700/40",
          "shadow-xl hover:shadow-2xl"
        ],
        
        // Gradient variants
        gradient: [
          "bg-gradient-to-br from-white via-white to-slate-50/50",
          "dark:from-slate-900 dark:via-slate-900 dark:to-slate-800/50",
          "border-white/40 dark:border-slate-700/40",
          "shadow-xl"
        ],
        "gradient-primary": [
          "bg-gradient-to-br from-primary/10 via-primary/5 to-transparent",
          "border-primary/20 hover:border-primary/30",
          "shadow-primary/10 hover:shadow-primary/20"
        ],
        
        // 3D & Interactive variants
        "3d": "card-3d-hover transform-gpu perspective-1000",
        interactive: "interactive-scale hover:shadow-lg transition-all duration-300",
        
        // Special variants
        blur: "bg-white/5 backdrop-blur-3xl border-white/10",
        minimal: "border border-border/50 bg-card/50",
        
        // Legacy compatibility
        default: "bg-card text-card-foreground border-border/50",
        ghost: "border-none shadow-none bg-transparent",
      },
      
      hover: {
        none: "",
        lift: "hover:-translate-y-1 hover:shadow-xl",
        glow: "hover:shadow-[0_0_30px_rgba(var(--primary),0.3)] hover:border-primary/50",
        spotlight: "hover:shadow-xl",
        float: "hover:-translate-y-2 hover:shadow-2xl",
        magnetic: "hover:scale-[1.02]",
        "3d": "hover:translate-y-[-8px] hover:rotate-x-[2deg] hover:rotate-y-[2deg]",
      },
      
      intensity: {
        subtle: "bg-white/60 dark:bg-black/30",
        medium: "bg-white/80 dark:bg-black/50", 
        strong: "bg-white/90 dark:bg-black/60",
      },
      
      padding: {
        none: "",
        sm: "p-4",
        md: "p-6", 
        lg: "p-8",
        xl: "p-10",
      },
      
      animation: {
        none: "",
        fadeIn: "animate-fadeIn",
        slideUp: "animate-slide-up", 
        scaleIn: "animate-scale-bounce",
        float: "animate-float",
        shimmer: "animate-shimmer",
        glow: "animate-pulse-glow",
      }
    },
    defaultVariants: {
      variant: "glass",
      hover: "lift",
      padding: "md",
    },
  }
);

export interface UnifiedCardProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, keyof HTMLMotionProps<'div'>>,
    VariantProps<typeof cardVariants>,
    Omit<HTMLMotionProps<'div'>, 'children'> {
  asChild?: boolean;
  children?: React.ReactNode;
  loading?: boolean;
  skeleton?: React.ReactNode;
  error?: string;
  retry?: () => void;
}

// Main Card Component with full TypeScript support
const UnifiedCard = forwardRef<HTMLDivElement, UnifiedCardProps>(
  ({ 
    className, 
    variant, 
    hover, 
    intensity, 
    padding, 
    animation,
    loading, 
    skeleton, 
    error, 
    retry,
    children, 
    asChild,
    ...props 
  }, ref) => {
    
    // Loading state
    if (loading) {
      return (
        <div
          ref={ref}
          className={cn(
            cardVariants({ variant, hover, intensity, padding, animation: "shimmer" }),
            "animate-pulse",
            className
          )}
          {...(props as any)}
        >
          {skeleton || <CardSkeleton />}
        </div>
      );
    }

    // Error state  
    if (error) {
      return (
        <div
          ref={ref}
          className={cn(
            cardVariants({ variant: "surface", hover: "none", padding }),
            "border-destructive/20 bg-destructive/5 dark:border-destructive/30 dark:bg-destructive/10",
            className
          )}
          {...(props as any)}
        >
          <div className="flex flex-col items-center justify-center p-6 text-center">
            <div className="text-destructive mb-2">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="text-sm font-medium text-destructive mb-1">Something went wrong</h3>
            <p className="text-xs text-muted-foreground mb-3">{error}</p>
            {retry && (
              <button
                onClick={retry}
                className="text-xs px-3 py-1 bg-destructive text-destructive-foreground rounded-md hover:bg-destructive/90 transition-colors"
              >
                Try again
              </button>
            )}
          </div>
        </div>
      );
    }

    // Motion props for animations
    const motionProps: HTMLMotionProps<'div'> = {
      whileHover: hover === 'glow' ? { 
        boxShadow: '0 0 30px rgba(var(--primary), 0.3)',
        borderColor: 'rgba(var(--primary), 0.5)'
      } : hover === 'magnetic' ? {
        scale: 1.02
      } : undefined,
      whileTap: { scale: 0.98 },
      initial: animation ? { opacity: 0, y: animation === 'slideUp' ? 20 : 0, scale: animation === 'scaleIn' ? 0.9 : 1 } : false,
      animate: animation ? { opacity: 1, y: 0, scale: 1 } : false,
      transition: { type: "spring", stiffness: 300, damping: 24 }
    };

    return (
      <motion.div
        ref={ref}
        className={cn(cardVariants({ variant, hover, intensity, padding, animation, className }))}
        {...motionProps}
        {...(props as any)}
      >
        <div className="relative z-10">
          {children}
        </div>
        
        {/* Optional decorative elements */}
        {variant?.includes('gradient') && (
          <div className="absolute inset-0 -z-10 opacity-30">
            <div className="absolute top-0 left-0 w-32 h-32 bg-gradient-to-br from-primary/20 to-transparent rounded-full blur-2xl" />
            <div className="absolute bottom-0 right-0 w-40 h-40 bg-gradient-to-tl from-secondary/20 to-transparent rounded-full blur-2xl" />
          </div>
        )}
      </motion.div>
    );
  }
);

UnifiedCard.displayName = 'UnifiedCard';

// Card sub-components for consistency
const CardHeader = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex flex-col space-y-1.5 p-6', className)}
      {...props}
    />
  )
);
CardHeader.displayName = 'CardHeader';

const CardTitle = forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn('text-2xl font-semibold leading-none tracking-tight', className)}
      {...props}
    />
  )
);
CardTitle.displayName = 'CardTitle';

const CardDescription = forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p
      ref={ref}
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  )
);
CardDescription.displayName = 'CardDescription';

const CardContent = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('p-6 pt-0', className)} {...props} />
  )
);
CardContent.displayName = 'CardContent';

const CardFooter = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex items-center p-6 pt-0', className)} {...props} />
  )
);
CardFooter.displayName = 'CardFooter';

// Loading skeleton component
const CardSkeleton = () => (
  <div className="animate-pulse">
    <div className="space-y-4">
      <div className="flex items-center space-x-4">
        <div className="rounded-full bg-muted h-10 w-10"></div>
        <div className="space-y-2 flex-1">
          <div className="h-4 bg-muted rounded w-3/4"></div>
          <div className="h-3 bg-muted rounded w-1/2"></div>
        </div>
      </div>
      <div className="space-y-2">
        <div className="h-3 bg-muted rounded"></div>
        <div className="h-3 bg-muted rounded w-5/6"></div>
      </div>
    </div>
  </div>
);

// Stats card specific variant
interface StatsCardProps extends UnifiedCardProps {
  title: string;
  value: string | number;
  change?: {
    value: number;
    type: 'increase' | 'decrease' | 'neutral';
  };
  icon?: React.ReactNode;
  suffix?: string;
  prefix?: string;
}

const StatsCard = forwardRef<HTMLDivElement, StatsCardProps>(
  ({ title, value, change, icon, suffix, prefix, className, ...props }, ref) => (
    <UnifiedCard
      ref={ref}
      variant="glass-magnetic"
      hover="glow"
      className={cn("relative overflow-hidden group", className)}
      {...props}
    >
      <CardContent className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            {icon && (
              <div className="p-2 rounded-xl bg-primary/10 text-primary">
                {icon}
              </div>
            )}
            <div>
              <p className="text-sm font-medium text-muted-foreground">{title}</p>
              <div className="flex items-baseline space-x-1">
                {prefix && <span className="text-lg font-semibold">{prefix}</span>}
                <h3 className="text-2xl font-bold tracking-tight">{value}</h3>
                {suffix && <span className="text-lg font-semibold text-muted-foreground">{suffix}</span>}
              </div>
            </div>
          </div>
          
          {change && (
            <div className={cn(
              "flex items-center space-x-1 px-2 py-1 rounded-full text-xs font-medium",
              change.type === 'increase' && "text-green-600 bg-green-100 dark:text-green-400 dark:bg-green-900/30",
              change.type === 'decrease' && "text-red-600 bg-red-100 dark:text-red-400 dark:bg-red-900/30",
              change.type === 'neutral' && "text-muted-foreground bg-muted"
            )}>
              <span>
                {change.type === 'increase' ? '↗' : change.type === 'decrease' ? '↘' : '→'}
              </span>
              <span>{Math.abs(change.value)}%</span>
            </div>
          )}
        </div>
        
        {/* Subtle gradient overlay on hover */}
        <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500">
          <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl from-primary/10 to-transparent rounded-full blur-2xl" />
        </div>
      </CardContent>
    </UnifiedCard>
  )
);
StatsCard.displayName = 'StatsCard';

// Quick actions card
interface QuickActionsCardProps {
  actions: Array<{
    label: string;
    onClick: () => void;
    icon: React.ReactNode;
    variant?: 'default' | 'destructive' | 'success';
    disabled?: boolean;
  }>;
  title?: string;
  className?: string;
}

const QuickActionsCard = forwardRef<HTMLDivElement, QuickActionsCardProps>(
  ({ actions, title = "Quick Actions", className }, ref) => (
    <UnifiedCard ref={ref} variant="glass" hover="lift" className={className}>
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3">
          {actions.map((action, index) => (
            <motion.button
              key={index}
              onClick={action.onClick}
              disabled={action.disabled}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className={cn(
                "flex flex-col items-center gap-2 p-4 rounded-xl transition-all duration-200",
                "hover:bg-muted/50 disabled:opacity-50 disabled:cursor-not-allowed",
                action.variant === 'destructive' && "hover:bg-destructive/10 text-destructive",
                action.variant === 'success' && "hover:bg-green-100 text-green-600 dark:hover:bg-green-900/20 dark:text-green-400"
              )}
            >
              {action.icon}
              <span className="text-sm font-medium">{action.label}</span>
            </motion.button>
          ))}
        </div>
      </CardContent>
    </UnifiedCard>
  )
);
QuickActionsCard.displayName = 'QuickActionsCard';

export {
  UnifiedCard,
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardDescription,
  CardContent,
  StatsCard,
  QuickActionsCard,
  CardSkeleton,
} from '@/components/ui/card'; // Re-export existing for compatibility

// For backward compatibility, keep original exports
export { UnifiedCard as Card };