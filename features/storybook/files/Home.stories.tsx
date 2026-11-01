import type { Meta, StoryObj } from 'storybook-react-rsbuild';
import { Home } from './Home';

const meta = { title: 'shell/Home', component: Home } satisfies Meta<typeof Home>;

export default meta;

// No registry is loaded in Storybook, so this is the empty state.
export const NoRemotes: StoryObj<typeof meta> = {};
