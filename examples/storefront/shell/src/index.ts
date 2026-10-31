import { main } from './bootstrap';

// Shared singletons are eager, so there is no async boundary to wait behind.
void main();
