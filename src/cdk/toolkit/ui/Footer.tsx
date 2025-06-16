import React, { useState } from 'react'
import { Box, Text } from 'ink'
import TextInput from 'ink-text-input'
import { ShortcutMenu } from './ShortcutMenu.js' // Using .js for ESM compatibility

export interface FooterProps {
  on_submit_input: (input_value: string) => void
}

export const Footer: React.FC<FooterProps> = ({ on_submit_input }) => {
  const [current_input, set_current_input] = useState<string>('')

  const handle_submit = (submitted_value: string): void => {
    on_submit_input(submitted_value)
    set_current_input('')
  }

  return (
    <Box flexDirection="column" width="100%">
      <Box paddingX={1}><Text dimColor>❯ </Text><TextInput value={current_input} onChange={set_current_input} onSubmit={handle_submit} placeholder="Type a command (not implemented yet)..." /></Box>
      <ShortcutMenu />
    </Box>
  )
}
