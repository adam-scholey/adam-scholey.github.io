"""Regression tests for page transitions and scroll reveals.

Static site, no framework - these tests assert the structural invariants of
the transition system in every HTML page. Run: python tests/test_transitions.py
"""
import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGES = ['index.html', 'skills.html', 'experience.html', 'contact.html',
         'projects.html', 'now.html', 'cv.html', 'diagrams.html']


def page(name):
    with open(os.path.join(ROOT, name), encoding='utf-8') as f:
        return f.read()


class PageTransitionTests(unittest.TestCase):
    def test_veil_element_present_and_hidden_from_at(self):
        for p in PAGES:
            html = page(p)
            self.assertIn('<div class="page-veil" aria-hidden="true"></div>', html, p)
            # veil element must be inside <body>
            self.assertLess(html.index('<body>'),
                            html.index('<div class="page-veil"'), p)

    def test_veil_css_timing_and_theme_background(self):
        for p in PAGES:
            html = page(p)
            self.assertIn('opacity .35s cubic-bezier(.4,0,.2,1)', html, p)
            self.assertIn('background:var(--bg)', html, p)
            # visual only - never blocks interaction
            self.assertIn('pointer-events:none', html, p)

    def test_js_gated_and_ready_state(self):
        for p in PAGES:
            html = page(p)
            # veil only appears when JS is on; JS adds .ready to fade out
            self.assertIn('.js .page-veil{opacity:1}', html, p)
            self.assertIn('.js .page-veil.ready{opacity:0}', html, p)

    def test_click_guards(self):
        for p in PAGES:
            html = page(p)
            for guard in ('e.defaultPrevented', 'e.button!==0', 'e.metaKey',
                          'e.ctrlKey', 'e.shiftKey', 'e.altKey',
                          'hasAttribute("download")', 'a.target',
                          'mailto:', 'tel:', 'javascript:', 'charAt(0)==="#"',
                          'u.origin!==location.origin'):
                self.assertIn(guard, html, '{}: {}'.format(p, guard))

    def test_back_forward_and_failure_safety(self):
        for p in PAGES:
            html = page(p)
            # pageshow resets veil for bfcache restores
            self.assertIn('addEventListener("pageshow"', html, p)
            # single-flight navigation guard
            self.assertIn('navTimer', html, p)
            self.assertIn('||navTimer)return', html, p)
            # timed safety reset if navigation is cancelled
            self.assertIn('visibilityState==="visible"', html, p)

    def test_reduced_motion_handling(self):
        for p in PAGES:
            html = page(p)
            self.assertIn('prefers-reduced-motion: reduce', html, p)
            self.assertIn('matchMedia("(prefers-reduced-motion: reduce)")', html, p)
            self.assertIn('html{scroll-behavior:auto}', html, p)
            self.assertIn('.js .page-veil{opacity:0}', html, p)

    def test_no_leftover_body_fade(self):
        for p in PAGES:
            html = page(p)
            self.assertNotIn('body{opacity', html, p)
            self.assertNotIn('body.ready', html, p)


class ScrollRevealTests(unittest.TestCase):
    def test_observer_spec(self):
        for p in PAGES:
            html = page(p)
            self.assertIn('{threshold:.1,rootMargin:"0px 0px -50px 0px"}', html, p)
            self.assertIn('observer.unobserve(entry.target)', html, p)
            self.assertIn('new IntersectionObserver', html, p)

    def test_reveal_css_spec(self):
        for p in PAGES:
            html = page(p)
            self.assertIn('transform:translateY(24px)', html, p)
            self.assertIn('transition:opacity .7s ease,transform .7s ease', html, p)
            self.assertNotIn('scale(.985)', html, p)
            self.assertNotIn('scale(1)}', html, p)


class PrefetchTests(unittest.TestCase):
    def test_prefetch_on_hover_and_touch(self):
        for p in PAGES:
            html = page(p)
            self.assertIn('addEventListener("pointerover"', html, p)
            self.assertIn('addEventListener("touchstart"', html, p)
            self.assertIn('l.rel="prefetch"', html, p)
            # no prefetch of links with side effects / new contexts
            for guard in ('t.target', 't.hasAttribute("download")',
                          'u.origin===location.origin'):
                self.assertIn(guard, html, '{}: {}'.format(p, guard))


class InlineScriptTests(unittest.TestCase):
    """Every inline <script> must parse - one bad string breaks a whole page."""
    def test_scripts_parse(self):
        import shutil, subprocess, tempfile
        if not shutil.which('node'):
            self.skipTest('node not available')
        for p in PAGES:
            html = page(p)
            for i, sc in enumerate(re.findall(r'<script>(.*?)</script>', html, re.S)):
                with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8') as t:
                    t.write(sc)
                r = subprocess.run(['node', '--check', t.name], capture_output=True, text=True)
                os.unlink(t.name)
                self.assertEqual(r.returncode, 0,
                                 '{} script {}: {}'.format(p, i, r.stderr.splitlines()[0] if r.stderr else ''))


class SanityTests(unittest.TestCase):
    def test_all_pages_parse(self):
        from html.parser import HTMLParser
        for p in PAGES:
            parser = HTMLParser()
            parser.feed(page(p))  # raises on malformed input

    def test_veil_is_only_overlay(self):
        for p in PAGES:
            self.assertEqual(page(p).count('page-veil" aria-hidden'), 1, p)


if __name__ == '__main__':
    unittest.main()
