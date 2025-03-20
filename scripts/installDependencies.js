/**
 * Script to check if required dependencies are installed and install them if needed
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Check if a package is installed
function isPackageInstalled(packageName) {
    try {
        require.resolve(packageName);
        console.log(`✅ ${packageName} is already installed`);
        return true;
    } catch (e) {
        console.log(`❌ ${packageName} is not installed`);
        return false;
    }
}

// Install a package
function installPackage(packageName) {
    console.log(`Installing ${packageName}...`);
    try {
        execSync(`npm install ${packageName}`, { stdio: 'inherit' });
        console.log(`✅ ${packageName} installed successfully`);
        return true;
    } catch (error) {
        console.error(`❌ Failed to install ${packageName}:`, error.message);
        return false;
    }
}

// Main function
function checkAndInstallDependencies() {
    const dependencies = ['@turf/turf'];
    let allInstalled = true;

    for (const dep of dependencies) {
        if (!isPackageInstalled(dep)) {
            const installed = installPackage(dep);
            if (!installed) {
                allInstalled = false;
            }
        }
    }

    if (allInstalled) {
        console.log('\nAll dependencies are installed. You can now run the validation script.');
    } else {
        console.error('\nSome dependencies could not be installed. Please install them manually and try again.');
    }
}

// Run the function
checkAndInstallDependencies(); 