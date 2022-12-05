console.clear();

async function run () {

    const result = await desk.Actions.executeAsync( {
    
        action : "testAllParameters",

        intValue : 5,
        floatValue : 2.3,
        stringValue : "hellow world",
        fileValue : "testing/testing.js",
        directoryValue : "testing",
        fileArrayValue : [
            "testing/testing.js",
            "testing/testing.json"
        ],
        intArrayValue : [ 2, 5, 10 ],
        floatArrayValue : [ 1.1, 3, 9.0, 100 ],
        stringArrayValue : [ "hello", "world", "again" , "!" ],
        base64dataValue : btoa("Hello, world"),

        stdout : true
    } );

    console.log( result.stdout );

}

run().catch( console.warn );