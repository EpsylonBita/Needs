import { expect } from 'vitest'
import * as matchers from '@testing-library/jest-dom/matchers'
import React from 'react'

expect.extend(matchers)

vi.mock('next/image', () => ({
  default: (props: any) => React.createElement('img', props)
}))

vi.mock('@/contexts/i18n-context', () => ({
  useI18n: () => ({ t: (k: string, d?: string) => (d ?? k) })
}))

// Polyfill ResizeObserver used by Radix UI components
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// @ts-ignore
global.ResizeObserver = RO as any

// Polyfill Pointer Events methods missing in jsdom used by Radix UI
// @ts-ignore
if (!Element.prototype.hasPointerCapture) {
  // @ts-ignore
  Element.prototype.hasPointerCapture = () => false
}
// @ts-ignore
if (!Element.prototype.setPointerCapture) {
  // @ts-ignore
  Element.prototype.setPointerCapture = () => {}
}

// Mock Radix Select to a minimal implementation for deterministic tests
vi.mock('@radix-ui/react-select', async () => {
  const React = await import('react')
  const Ctx = (React as any).createContext({ onValueChange: (_: any) => {} })
  const Root = ({ value, onValueChange, children }: any) => (React as any).createElement(Ctx.Provider, { value: { onValueChange } }, children)
  const Trigger = (React as any).forwardRef((props: any, ref: any) => (React as any).createElement('button', { ref, role: 'combobox', ...props }))
  const Content = (React as any).forwardRef((props: any, ref: any) => (React as any).createElement('div', { ref, ...props }))
  const Item = (React as any).forwardRef(({ value, children, ...props }: any, ref: any) => {
    const ctx = (React as any).useContext(Ctx)
    return (React as any).createElement('div', { ref, role: 'option', onClick: () => ctx.onValueChange(value), ...props }, children)
  })
  const Group = ({ children }: any) => (React as any).createElement('div', null, children)
  const Label = ({ children }: any) => (React as any).createElement('div', null, children)
  const ItemIndicator = ({ children }: any) => (React as any).createElement('span', null, children)
  const Separator = (React as any).forwardRef((props: any, ref: any) => (React as any).createElement('hr', { ref, ...props }))
  const Value = (props: any) => (React as any).createElement('span', { ...props })
  const Icon = ({ children }: any) => children
  const Portal = ({ children }: any) => children
  const Viewport = (props: any) => (React as any).createElement('div', { ...props })
  return { Root, Trigger, Content, Item, Group, Label, ItemIndicator, Separator, Value, Icon, Portal, Viewport }
})

// Mock our UI Select wrapper to simplify interactions
vi.mock('@/components/ui/select', async () => {
  const React = await import('react')
  const Ctx = (React as any).createContext({ onValueChange: (_: any) => {} })
  const Select = ({ value, onValueChange, children }: any) => (React as any).createElement(Ctx.Provider, { value: { onValueChange, value } }, children)
  const SelectTrigger = (React as any).forwardRef((props: any, ref: any) => (React as any).createElement('button', { ref, role: 'combobox', ...props }))
  const SelectContent = (React as any).forwardRef((props: any, ref: any) => (React as any).createElement('div', { ref, ...props }))
  const SelectItem = (React as any).forwardRef(({ value, children, ...props }: any, ref: any) => {
    const ctx = (React as any).useContext(Ctx)
    return (React as any).createElement('div', { ref, role: 'option', onClick: () => ctx.onValueChange(value), ...props }, children)
  })
  const SelectGroup = ({ children }: any) => (React as any).createElement('div', null, children)
  const SelectLabel = ({ children }: any) => (React as any).createElement('div', null, children)
  const SelectSeparator = (React as any).forwardRef((props: any, ref: any) => (React as any).createElement('hr', { ref, ...props }))
  const SelectValue = (props: any) => (React as any).createElement('span', { ...props })
  return { Select, SelectTrigger, SelectContent, SelectItem, SelectGroup, SelectLabel, SelectSeparator, SelectValue }
})