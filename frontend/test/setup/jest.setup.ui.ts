import '@testing-library/jest-dom'


jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    refresh: jest.fn(),
    prefetch: jest.fn(),
    back: jest.fn(),
    forward: jest.fn(),
  }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}))

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: jest.fn().mockImplementation((query: string) => ({
    matches: false, media: query, onchange: null,
    addListener: jest.fn(), removeListener: jest.fn(),
    addEventListener: jest.fn(), removeEventListener: jest.fn(), dispatchEvent: jest.fn(),
  })),
});
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
global.ResizeObserver = ResizeObserverMock;
if (!HTMLElement.prototype.scrollIntoView) HTMLElement.prototype.scrollIntoView = jest.fn();
// jsdom has no layout animations; Headless UI only needs the empty-animation state.
if (!Element.prototype.getAnimations) Element.prototype.getAnimations = () => [];
