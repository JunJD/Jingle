"use client"

import { motion } from "motion/react"
import { cn } from "@/lib/utils"

export const LoaderOne = ({ className }: { className?: string }) => {
  const transition = (index: number) => ({
    delay: index * 0.12,
    duration: 0.8,
    ease: "easeInOut" as const,
    repeat: Infinity,
    repeatType: "mirror" as const
  })

  return (
    <div
      aria-hidden="true"
      className={cn("inline-flex h-3.5 items-center gap-1 text-muted-foreground", className)}
    >
      {[0, 1, 2].map((index) => (
        <motion.div
          key={index}
          animate={{ opacity: [0.35, 1, 0.35] }}
          transition={transition(index)}
          className="size-1.5 rounded-full bg-current"
        />
      ))}
    </div>
  )
}
