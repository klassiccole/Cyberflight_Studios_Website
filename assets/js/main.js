/*
	Cyberflight Studios
	Site-wide JavaScript

	Originally based on Dimension by HTML5 UP
	html5up.net | @ajlkn
	CCA 3.0 license: html5up.net/license

	The original Dimension single-page article navigation has been removed.
	Cyberflight Studios now uses a multi-page structure with dedicated URLs
	for improved navigation, maintainability, and search engine indexing.
*/

(function () {

	'use strict';

/*
 * Initial Page Animation
 *
 * Removes the preload class after the document loads,
 * allowing the page to fade into view.
 */
    document.addEventListener('DOMContentLoaded', function () {

        window.setTimeout(function () {
            document.body.classList.remove('is-preload');
        }, 100);

    });

/*
* Navigation Alignment
*
* Preserves Dimension's centered navigation styling when the
* navigation contains an even number of menu items.
*/
	document.addEventListener('DOMContentLoaded', function () {

		const nav = document.querySelector('#header nav');

		if (!nav)
			return;

		const navItems = nav.querySelectorAll('li');

		if (navItems.length > 0 && navItems.length % 2 === 0) {

			nav.classList.add('use-middle');

			navItems[navItems.length / 2].classList.add('is-middle');

		}

	});

/*
* Standalone Page Home Button
*
* Automatically adds a Home button to the upper-right corner of
* standalone pages. This keeps navigation consistent without requiring
* the button to be manually added to every HTML file.
*/
    document.addEventListener('DOMContentLoaded', function () {

        if (!document.body.classList.contains('standalone-page'))
            return;

        const article = document.querySelector('#main article');

        if (!article)
            return;

        const homeButton = document.createElement('a');

        homeButton.href = '/';
        homeButton.className = 'page-home icon solid fa-home';
        homeButton.setAttribute('aria-label', 'Home');
        homeButton.setAttribute('title', 'Home');

        article.appendChild(homeButton);

    });

})();