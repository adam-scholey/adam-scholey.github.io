document.addEventListener('DOMContentLoaded', () => {
    // Mobile nav toggle
    const toggle = document.querySelector('.nav-toggle');
    const navLinks = document.querySelector('.nav-links');

    if (toggle && navLinks) {
        toggle.addEventListener('click', () => {
            navLinks.classList.toggle('hidden');
            navLinks.classList.toggle('flex');
            navLinks.classList.toggle('flex-col');
            navLinks.classList.toggle('absolute');
            navLinks.classList.toggle('top-full');
            navLinks.classList.toggle('left-0');
            navLinks.classList.toggle('right-0');
            navLinks.classList.toggle('bg-cream-50');
            navLinks.classList.toggle('border-b');
            navLinks.classList.toggle('border-cream-200');
            navLinks.classList.toggle('p-6');
            navLinks.classList.toggle('space-y-4');
        });

        // Close mobile nav on link click
        navLinks.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', () => {
                navLinks.classList.add('hidden');
                navLinks.classList.remove('flex', 'flex-col', 'absolute', 'top-full', 'left-0', 'right-0', 'bg-cream-50', 'border-b', 'border-cream-200', 'p-6', 'space-y-4');
            });
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
                b.classList.add('bg-white', 'text-forest-600', 'border', 'border-forest-300');
            });
            btn.classList.remove('bg-white', 'text-forest-600', 'border', 'border-forest-300');
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
