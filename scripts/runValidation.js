/**
 * Simple script to run the route validation
 */
const { validateRoutes } = require('./validateRoutes');

console.log('Starting route validation...');
validateRoutes()
    .then(results => {
        console.log('Route validation completed successfully');
        process.exit(0);
    })
    .catch(error => {
        console.error('Route validation failed:', error);
        process.exit(1);
    }); 