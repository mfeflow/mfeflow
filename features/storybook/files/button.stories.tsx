import type { Meta, StoryObj } from 'storybook-react-rsbuild';
import { Button } from './button';

const meta = {
  title: 'ui/Button',
  component: Button,
  args: { children: 'Save' },
} satisfies Meta<typeof Button>;

export default meta;

export const Default: StoryObj<typeof meta> = {};
export const Secondary: StoryObj<typeof meta> = { args: { variant: 'secondary' } };
export const Destructive: StoryObj<typeof meta> = { args: { variant: 'destructive' } };
