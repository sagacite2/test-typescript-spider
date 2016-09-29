export const wait_seconds = function (senconds: number) {
    return new Promise(resolve => setTimeout(resolve, senconds * 1000));
}