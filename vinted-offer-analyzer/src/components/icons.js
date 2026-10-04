import {
  Baby, Briefcase, Clock, Coffee, Crown, Footprints, Gem, Moon, Package, Shirt, Smartphone, Sun, Sparkles, Utensils, Zap,
} from 'lucide-react'

/** Lucide icon by the name stored in core constants (UI concern, kept out of core). */
export const ICONS = { Baby, Briefcase, Clock, Coffee, Crown, Footprints, Gem, Moon, Package, Shirt, Smartphone, Sun, Sparkles, Zap }

export const iconByName = (name) => ICONS[name] || Sparkles

export const WINDOW_ICONS = {
  sunday_night: Sparkles,
  weeknight_late: Moon,
  weeknight_early: Moon,
  weeknight_end: Moon,
  friday_night: Moon,
  saturday_night: Moon,
  sunday_afternoon: Sun,
  sunday_morning: Sun,
  saturday_morning: Sun,
  after_dinner: Utensils,
  night: Moon,
  commute: Briefcase,
  work_morning: Briefcase,
  pre_lunch: Coffee,
  lunch: Coffee,
  work_afternoon: Briefcase,
  neutral: Clock,
}

export const windowIcon = (id) => WINDOW_ICONS[id] || Clock
