// deploy/00_deploy_HealthChain.ts
import type { DeployFunction } from "hardhat-deploy/types";

const deploy: DeployFunction = async ({ midl }) => {
    console.log("--- Starting HealthChain Deployment Process ---");

    await midl.initialize();

    console.log("MIDL Hardhat SDK initialized.");
    // TEST 1: Check midl.account
    if (midl.account && midl.account.address) {
        console.log("Deployer EVM Address:", midl.account.address);
    } else {
        console.error("ERROR: midl.account or midl.account.address is undefined after initialization!");
        throw new Error("EVM account not found."); // Stop here
    }


    /**
     * Add the deploy contract transaction intention for HealthChain
     */
    await midl.deploy("HealthChain", []); // Deploy "HealthChain" with no constructor arguments

    /**
     * Sends the BTC transaction and EVM transaction to the network
     */
    await midl.execute();
    console.log("HealthChain contract deployment transaction executed.");

    // After execution, you can get the deployed contract's address
    const healthChainContract = await midl.get("HealthChain");
    console.log(`HealthChain deployed at: ${healthChainContract.address}`);

    console.log("--- HealthChain Deployment Complete ---");

    // Optional: Provide verification command for the deployed contract
    console.log("\nVerification Command (after deployment is confirmed on chain):");
    console.log(`pnpm hardhat verify ${healthChainContract.address} --network regtest`);
};

deploy.tags = ["HealthChain"];
export default deploy;