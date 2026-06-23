document.addEventListener('DOMContentLoaded', () => {
    // Mobile nav toggle
    const toggle = document.querySelector('.nav-toggle');
    const navLinks = document.querySelector('.nav-links');

    if (toggle && navLinks) {
        const openMenu = () => {
            navLinks.classList.remove('hidden');
            navLinks.classList.add('flex');
        };
        const closeMenu = () => {
            navLinks.classList.add('hidden');
            navLinks.classList.remove('flex');
        };

        toggle.addEventListener('click', () => {
            if (navLinks.classList.contains('hidden')) {
                openMenu();
            } else {
                closeMenu();
            }
        });

        // Close mobile nav on link click
        navLinks.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', closeMenu);
        });
    }

    // Project filtering (projects page only)
    const filterBtns = document.querySelectorAll('.filter-btn');
    const projectCards = document.querySelectorAll('article[data-category]');

    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const filter = btn.dataset.filter;

            // Update button styles
            filterBtns.forEach(b => {
                b.classList.remove('bg-forest-900', 'text-white');
                b.classList.add('bg-forest-800', 'text-cream-200', 'border', 'border-forest-700');
            });
            btn.classList.remove('bg-forest-800', 'text-cream-200', 'border', 'border-forest-700');
            btn.classList.add('bg-forest-900', 'text-white');

            // Filter cards
            projectCards.forEach(card => {
                if (filter === 'all' || card.dataset.category === filter) {
                    card.classList.remove('hidden');
                } else {
                    card.classList.add('hidden');
                }
            });
        });
    });

    // Fade-in on scroll
    const observer = new IntersectionObserver(
        (entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.style.opacity = '1';
                    entry.target.style.transform = 'translateY(0)';
                }
            });
        },
        { threshold: 0.1 }
    );

    document.querySelectorAll('article[data-category], .bg-white, .bg-cream-50, .border-l-2').forEach(el => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(20px)';
        el.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
        observer.observe(el);
    });
});
